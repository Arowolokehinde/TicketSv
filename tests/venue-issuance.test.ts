import { describe, expect, it, vi } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { findIssuanceAction, prepareVenueRecipient, issueVenueTicket } from '../src/wallet/venue-issuance.ts'
import { verifyIssuer, verifyContinuity, verifyRecipient } from '../src/verification/authenticity.ts'

async function fixture() {
 const wallet = syntheticSigningWallet()
 const owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
 const request = await prepareVenueRecipient(wallet, owner, 'ticket-test')
 return { wallet, owner, request }
}
it('issues exactly once to the reviewed key and attests the event and ticket', async () => {
 const { wallet, owner, request } = await fixture()
 const create = vi.spyOn(wallet, 'createAction'), checkpoint = vi.fn(async () => {})
 const pkg = await issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, checkpoint)
 expect(create).toHaveBeenCalledTimes(1)
 expect(create.mock.calls[0][0].options).toMatchObject({ noSend: false, acceptDelayedBroadcast: false, randomizeOutputs: false })
 expect(checkpoint).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/))
 expect(() => verifyIssuer(pkg, owner)).not.toThrow()
 expect(() => verifyContinuity(pkg)).not.toThrow()
 expect(() => verifyRecipient(pkg, request)).not.toThrow()
})
it('stops before creation on changed network or identity', async () => {
 const { wallet, owner, request } = await fixture(), create = vi.spyOn(wallet, 'createAction')
 wallet.getNetwork = async () => ({ network: 'mainnet' })
 await expect(issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, async () => {})).rejects.toThrow(/testnet/i)
 expect(create).not.toHaveBeenCalled()
})
it('does not request attestation when saving the returned transaction reference fails', async () => {
 const { wallet, owner, request } = await fixture(), sign = vi.spyOn(wallet, 'createSignature'), create = vi.spyOn(wallet, 'createAction')
 await expect(issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, async () => { throw Error('storage failed') })).rejects.toThrow('storage failed')
 expect(create).toHaveBeenCalledTimes(1); expect(sign).not.toHaveBeenCalled()
})
it('preserves the transaction reference and never retries a declined attestation', async () => {
 const { wallet, owner, request } = await fixture(), checkpoint = vi.fn(async () => {}), create = vi.spyOn(wallet, 'createAction')
 vi.spyOn(wallet, 'createSignature').mockRejectedValue(Error('declined'))
 await expect(issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, checkpoint)).rejects.toThrow('declined')
 expect(checkpoint).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1)
})

it('prefers newer server mining evidence over an old local recovery copy', async () => {
 const { recoveryCandidate } = await import('../src/events/issuance-recovery.ts')
 const { Transaction, MerklePath, Utils } = await import('@bsv/sdk')
 const { wallet, owner, request } = await fixture()
 const original = await issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, async () => {})
 const tx = Transaction.fromAtomicBEEF(Utils.toArray(original.atomicBeefBase64, 'base64'))
 tx.merklePath = new MerklePath(2, [[{ offset: 0, hash: tx.id('hex'), txid: true }]])
 const mined = { ...original, atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) }
 expect(recoveryCandidate(mined, original)).toBeUndefined()
 expect(recoveryCandidate(original, mined)).toEqual(mined)
 expect(recoveryCandidate(original, original)).toBeUndefined()
 expect(recoveryCandidate(null, original)).toEqual(original)
})

it('stops before the venue signature if the wallet switches identities after creation', async () => {
 const { wallet, owner, request } = await fixture(), sign = vi.spyOn(wallet, 'createSignature')
 await expect(issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, async () => {
  wallet.getPublicKey = async () => ({ publicKey: '02' + '11'.repeat(32) })
 })).rejects.toThrow(/identity/i)
 expect(sign).not.toHaveBeenCalled()
})
it('rejects a substituted receiving key before creating a transaction', async () => {
 const { wallet, owner, request } = await fixture(), create = vi.spyOn(wallet, 'createAction')
 const other = await prepareVenueRecipient(wallet, owner, 'other-ticket')
 await expect(issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', other, async () => {})).rejects.toThrow(/receiving key/i)
 expect(create).not.toHaveBeenCalled()
 expect(other.recipient.publicKey).not.toBe(request.recipient.publicKey)
})
describe('findIssuanceAction', () => {
 const owner = PrivateKey.fromRandom().toPublicKey().toString(), ticketId = '11111111-2222-4333-8444-555555555555'
 const action = (txid: string, status: string) => ({ txid: txid.repeat(64), status, satoshis: 0, isOutgoing: true, description: 'Issue TicketSV event ticket', version: 1, lockTime: 0 })
 const reader = (actions: ReturnType<typeof action>[], extra: { network?: string; totalActions?: number } = {}) => ({
  getNetwork: async () => ({ network: extra.network ?? 'testnet' }), getPublicKey: async () => ({ publicKey: owner }),
  listActions: vi.fn(async (_args: unknown) => ({ totalActions: extra.totalActions ?? actions.length, actions })),
 }) as unknown as Parameters<typeof findIssuanceAction>[0] & { listActions: ReturnType<typeof vi.fn> }
 it('asks the wallet only for this ticket label', async () => {
  const wallet = reader([])
  expect(await findIssuanceAction(wallet, owner, ticketId)).toBeUndefined()
  expect(wallet.listActions).toHaveBeenCalledWith(expect.objectContaining({ labels: [`ticketsv-issuance-${ticketId}`], labelQueryMode: 'any' }))
 })
 it('treats failed actions as absent', async () => {
  expect(await findIssuanceAction(reader([action('a', 'failed')]), owner, ticketId)).toBeUndefined()
 })
 it('returns the one live transaction', async () => {
  expect(await findIssuanceAction(reader([action('a', 'failed'), action('b', 'completed')]), owner, ticketId)).toBe('b'.repeat(64))
 })
 it('stops when several live transactions carry the label', async () => {
  await expect(findIssuanceAction(reader([action('a', 'unproven'), action('b', 'completed')]), owner, ticketId)).rejects.toThrow(/several/i)
 })
 it('stops when the wallet listing is incomplete', async () => {
  await expect(findIssuanceAction(reader([], { totalActions: 1 }), owner, ticketId)).rejects.toThrow(/incomplete/i)
 })
 it('checks network and identity before listing', async () => {
  const wallet = reader([], { network: 'mainnet' })
  await expect(findIssuanceAction(wallet, owner, ticketId)).rejects.toThrow(/testnet/i)
  expect(wallet.listActions).not.toHaveBeenCalled()
  await expect(findIssuanceAction(reader([]), PrivateKey.fromRandom().toPublicKey().toString(), ticketId)).rejects.toThrow(/identity/i)
 })
})
