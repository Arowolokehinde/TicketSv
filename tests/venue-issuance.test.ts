import { expect, it, vi } from 'vitest'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { prepareVenueRecipient, issueVenueTicket } from '../src/wallet/venue-issuance.ts'
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
