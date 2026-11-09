import { describe, expect, it } from 'vitest'
import { PrivateKey, ProtoWallet, Utils } from '@bsv/sdk'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { ticketFixture } from './helpers/ticket-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { HANDOFF_PROTOCOL, type HandoffRequest } from '../src/handoff/types.ts'
import { fromAttendee, invitationFor, readHandoffRequest, readHandoffTicket, readInvitation, receiveHandoffTicket, requestBytes, verifyHandoffTicket } from '../src/handoff/evidence.ts'
import { readSender, sourceKey, readRecipient, recipientKey } from '../src/handoff/store.ts'
async function original() { const f = await attendeeOfflineFixture(); return fromAttendee(attendeeEvidence(f.record, f.identity, 'http://127.0.0.1:4175')) }
async function signed(invitation: HandoffRequest['invitation'], wallet = new ProtoWallet(new PrivateKey(7)), requestId = 'receive-1'): Promise<HandoffRequest> {
 const recipientIdentity = (await wallet.getPublicKey({ identityKey: true })).publicKey
 const binding = { protocolID: [2, 'counterfoil ticket receiving'] as [2,string], keyID: requestId, counterparty: 'self' }
 const request = { kind: 'ticket-request' as const, version: 1 as const, network: 'testnet' as const, requestId, recipient: { ...binding, publicKey: (await wallet.getPublicKey({ ...binding, forSelf: true })).publicKey } }
 const v = { kind: 'ticketsv-handoff-request' as const, version: 1 as const, invitation, recipientIdentity, request }, data = requestBytes(v)
 return { ...v, keySignature: Utils.toBase64((await wallet.createSignature({ ...binding, data })).signature), identitySignature: Utils.toBase64((await wallet.createSignature({ protocolID: HANDOFF_PROTOCOL, keyID: requestId, counterparty: 'anyone', data })).signature) }
}
describe('handoff independent evidence', () => {
 it('preserves strict original evidence and normalizes invitation metadata', async () => {
  const t = await original(), i = invitationFor(t)
  expect(readInvitation(i)).toEqual(i); expect(readHandoffTicket(t)).toEqual(t)
  expect(t.issuanceEvidence?.attendee).toBe(t.holder)
  expect(() => readHandoffTicket({ ...t, holder: t.trustedVenue })).toThrow()
  expect(() => readInvitation({ ...i, origin: i.origin + '/path' })).toThrow()
  expect((await verifyHandoffTicket(t)).checks.filter(c => c.name !== 'anchors').every(c => c.status === 'pass')).toBe(true)
 })
 it('binds canonical receiving-key and independently derived identity signatures to all context', async () => {
  const request = await signed(invitationFor(await original()))
  expect(readHandoffRequest(request)).toEqual(request)
  expect(requestBytes({ ...request, invitation: { ...request.invitation } })).toEqual(requestBytes(request))
  for (const changed of [ { ...request, recipientIdentity: request.invitation.trustedVenue }, { ...request, keySignature: request.identitySignature }, { ...request, invitation: { ...request.invitation, source: { ...request.invitation.source, index: 1 } } }, { ...request, invitation: { ...request.invitation, trustedVenue: request.recipientIdentity } } ]) expect(() => readHandoffRequest(changed)).toThrow()
 })
 it('accepts a direct successor with only missing anchors but requires its independently saved request', async () => {
  const f = await ticketFixture(), event = (await original()).event
  const invitation = { kind: 'ticketsv-handoff-invitation' as const, version: 1 as const, network: 'testnet' as const, origin: 'http://localhost:5175', eventId: 'event', ticketId: 'ticket', source: f.pkg.issuance.origin, trustedVenue: f.identity, event }
  const request = await signed(invitation, f.wallet, f.destination.requestId)
  const value = { kind: 'ticketsv-handoff-ticket', version: 1, origin: invitation.origin, holder: request.recipientIdentity, trustedVenue: f.identity, event, request, pkg: f.pkg, savedAt: new Date().toISOString() }
  const accepted = await receiveHandoffTicket(value, request, f.identity)
  expect(accepted.pkg.current).toEqual(f.pkg.current)
  expect((await verifyHandoffTicket(accepted)).verdict).toBe('incomplete')
  await expect(receiveHandoffTicket(value, await signed(invitation), f.identity)).rejects.toThrow()
  await expect(receiveHandoffTicket(value, request, (await original()).holder)).rejects.toThrow()
  const changed = await signed({ ...invitation, source: { ...invitation.source, index: 1 } }, f.wallet, f.destination.requestId)
  expect(() => readHandoffTicket({ ...value, request: changed })).toThrow()
  const damaged = structuredClone(value); damaged.pkg.lineageRawTxs[1] = damaged.pkg.lineageRawTxs[1].slice(0, -8) + '01000000'
  await expect(receiveHandoffTicket(damaged, request, f.identity)).rejects.toThrow()
 })
 it('blocks same-source record reset, changed identity and reversed attempts', async () => {
  const ticket = await original(), now = new Date().toISOString()
  const first = readSender({ kind: 'ticketsv-handoff-sender', version: 1, id: sourceKey(ticket), revision: 0, ticket })
  const claimed = readSender({ ...first, revision: 1, fundAttempt: { id: 'one', outcome: 'pending', startedAt: now } }, first)
  expect(() => readSender({ ...claimed, revision: 2, fundAttempt: undefined }, claimed)).toThrow()
  expect(() => readSender({ ...claimed, revision: 2, fundAttempt: { ...claimed.fundAttempt, id: 'two' } }, claimed)).toThrow()
  const completed = readSender({ ...claimed, revision: 2, fundAttempt: { ...claimed.fundAttempt, outcome: 'unknown', finishedAt: now } }, claimed)
  expect(() => readSender({ ...claimed, revision: 3 }, completed)).toThrow()
  expect(() => readSender({ ...first, id: 'new-run' })).toThrow()
  expect(() => readSender({ ...claimed, revision: 2, ticket: { ...ticket, event: { ...ticket.event, name: 'changed' } } }, claimed)).toThrow()
 })
 it('requires recipient IDs and immutable independently saved requests', async () => {
  const request = await signed(invitationFor(await original())), r = readRecipient({ kind: 'ticketsv-handoff-recipient', version: 1, id: recipientKey(request), revision: 0, request })
  expect(() => readRecipient({ ...r, revision: 1, request: { ...request, identitySignature: request.keySignature } }, r)).toThrow()
  expect(() => readRecipient({ ...r, id: 'other' })).toThrow()
 })
})
it('preserves funding receipts and exact funding transaction through subsequent record updates', async () => {
 const ticket = await original(), now = new Date().toISOString()
 const first = readSender({ kind: 'ticketsv-handoff-sender', version: 1, id: sourceKey(ticket), revision: 0, ticket })
 const funding = { key: { ...ticket.pkg.request.recipient, protocolID: [2, 'ticketsv handoff fees'], keyID: sourceKey(ticket) }, amount: 1, policy: { maxTxBytes: 100000, feeSatoshis: 0, feeBytes: 1000 }, rawReceipt: { txid: ticket.pkg.current.txid, tx: [1, 2, 3] } }
 const claimed = readSender({ ...first, revision: 1, funding, fundAttempt: { id: 'claim', outcome: 'pending', startedAt: now } }, first)
 for (const change of [{ rawReceipt: { txid: '00'.repeat(32) } }, { rawReceipt: undefined }, { amount: 2 }, { key: { ...funding.key, keyID: 'another-source' } }]) expect(() => readSender({ ...claimed, revision: 2, funding: { ...funding, ...change } }, claimed)).toThrow()
 const unknown = readSender({ ...claimed, revision: 2, fundAttempt: { ...claimed.fundAttempt, outcome: 'unknown', finishedAt: now } }, claimed)
 expect(() => readSender({ ...unknown, revision: 3, fundAttempt: { ...unknown.fundAttempt, outcome: 'complete' } }, unknown)).toThrow()
 expect(() => readSender({ ...first, revision: 1, fundAttempt: { id: 'skip', outcome: 'unknown', startedAt: now, finishedAt: now } }, first)).toThrow()
})
it('rejects malformed persisted funding rather than silently retaining plausible transaction labels', async () => {
 const ticket = await original(), now = new Date().toISOString()
 expect(() => readSender({ kind: 'ticketsv-handoff-sender', version: 1, id: sourceKey(ticket), revision: 0, ticket, funding: { key: ticket.pkg.request.recipient, amount: 1, policy: { maxTxBytes: 4096, feeSatoshis: 0, feeBytes: 1000 }, txid: '00'.repeat(32), beef: 'AA==', index: 0 }, fundAttempt: { id: 'claim', outcome: 'complete', startedAt: now, finishedAt: now } })).toThrow()
})
it('retains optional signed header preparation height and rejects tampering or invalid ranges', async () => {
 const ticket = await original(), invitation = invitationFor(ticket, 1762324), request = await signed(invitation)
 expect(readHandoffRequest(request).invitation.requiredHeight).toBe(1762324)
 expect(() => readHandoffRequest({ ...request, invitation: { ...invitation, requiredHeight: 1762325 } })).toThrow()
 for (const requiredHeight of [-1, 1.5, 1000000001, '1762324']) expect(() => readInvitation({ ...invitation, requiredHeight })).toThrow()
 expect(invitationFor(ticket).requiredHeight).toBeUndefined()
})
