import { PrivateKey, ProtoWallet, PushDrop, Transaction, Utils, MerklePath, type WalletInterface } from '@bsv/sdk'
import { attendeeOfflineFixture } from './attendee-offline-fixture.ts'
import { attendeeEvidence } from '../../src/offline/attendee-evidence.ts'
import { fromAttendee, invitationFor, readHandoffTicket } from '../../src/handoff/evidence.ts'
import { createReceivingRequest } from '../../src/handoff/wallet.ts'
import { ticketScript } from '../../src/tickets/script.ts'
import type { HandoffTicket } from '../../src/handoff/types.ts'
export async function compactTicketFixture() {
  const f = await attendeeOfflineFixture('https://ticketsv.example'),
    original = fromAttendee(attendeeEvidence(f.record, f.identity, 'https://ticketsv.example'))
  return { original, transfer: await extend(original, 2, 3) }
}
export async function extend(value: HandoffTicket, seller: number, buyer: number, minedSource = false) {
  const wallet = Object.assign(new ProtoWallet(new PrivateKey(seller)), { getNetwork: async () => ({ network: 'testnet' as const }) }),
    receiver = Object.assign(new ProtoWallet(new PrivateKey(buyer)), { getNetwork: async () => ({ network: 'testnet' as const }) })
  const request = await createReceivingRequest(receiver, invitationFor(value, 1767665), new AbortController().signal),
    pkg = value.pkg,
    source = Transaction.fromAtomicBEEF(Utils.toArray(pkg.atomicBeefBase64, 'base64'))
  if (minedSource)
    source.merklePath = new MerklePath(1767665, [
      [
        { offset: 1, hash: source.id('hex'), txid: true },
        { offset: 0, hash: '11'.repeat(32) },
      ],
    ])
  const tx = new Transaction(
    1,
    [{ sourceTransaction: source, sourceOutputIndex: pkg.current.index }],
    [{ satoshis: 1, lockingScript: ticketScript(pkg.issuance.eventId, pkg.issuance.ticketId, pkg.issuance.origin, request.request) }],
  )
  const key = pkg.request.recipient
  tx.inputs[0].unlockingScript = await new PushDrop(wallet as unknown as WalletInterface)
    .unlock(key.protocolID, key.keyID, key.counterparty, 'all', false)
    .sign(tx, 0)
  return readHandoffTicket({
    ...value,
    holder: request.recipientIdentity,
    request,
    savedAt: new Date().toISOString(),
    pkg: {
      ...pkg,
      current: { txid: tx.id('hex'), index: 0 },
      request: request.request,
      lineageRawTxs: [...pkg.lineageRawTxs, tx.toHex()],
      atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()),
    },
  })
}
