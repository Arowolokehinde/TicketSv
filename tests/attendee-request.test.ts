import { expect, it, vi } from 'vitest'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import { prepareAttendeeRequest } from '../src/wallet/attendee-request.ts'
import { verifyRequestProof } from '../src/marketplace/request-proof.ts'
import { issueAttendeeTicket } from '../src/wallet/venue-issuance.ts'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { verifyRecipient } from '../src/verification/authenticity.ts'

it('binds a receiving signature to attendee, event, publication, venue and website', async () => {
 const wallet = new ProtoWallet(new PrivateKey(7)) as WalletInterface
 wallet.getNetwork = async () => ({ network: 'testnet' })
 const owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
 const venue = (await syntheticSigningWallet().getPublicKey({ identityKey: true })).publicKey
 const context = { eventId: crypto.randomUUID(), revision: 1, venue, attendee: owner, origin: 'http://localhost:5175' }
 const proof = await prepareAttendeeRequest(wallet, context, crypto.randomUUID())
 expect(() => verifyRequestProof(proof, context)).not.toThrow()
 for (const altered of [{ eventId: crypto.randomUUID() }, { revision: 2 }, { venue: owner }, { attendee: venue }, { origin: 'http://localhost:9999' }]) {
  expect(() => verifyRequestProof(proof, { ...context, ...altered })).toThrow()
 }
 expect(() => verifyRequestProof({ ...proof, signature: 'AAAA' }, context)).toThrow()
 const organiser = syntheticSigningWallet(), create = vi.spyOn(organiser, 'createAction')
 const pkg = await issueAttendeeTicket(organiser, venue, context.eventId, crypto.randomUUID(), proof, async () => {})
 expect(() => verifyRecipient(pkg, proof.request)).not.toThrow()
 expect(create.mock.calls[0][0].outputs![0].basket).toBeUndefined()
 expect(create.mock.calls[0][0].outputs![0].customInstructions).toBeUndefined()
 expect(pkg.request.recipient.publicKey).not.toBe(venue)
})
it('refuses a receiving signature after a wallet identity switch', async () => {
 const wallet = syntheticSigningWallet(), owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
 const sign = vi.spyOn(wallet, 'createSignature')
 await expect(prepareAttendeeRequest(wallet, { eventId: crypto.randomUUID(), revision: 1, venue: owner, attendee: (await new ProtoWallet(new PrivateKey(8)).getPublicKey({ identityKey: true })).publicKey, origin: 'http://localhost:5175' }, crypto.randomUUID())).rejects.toThrow(/identity/)
 expect(sign).not.toHaveBeenCalled()
})
