import { PrivateKey, ProtoWallet, Transaction, LockingScript, UnlockingScript, MerklePath, Utils } from '@bsv/sdk'
import { issuanceBytes, ticketScript } from '../../src/tickets/script.ts'
import { requestProofBytes } from '../../src/marketplace/request-proof.ts'
import type { VenueIssuance } from '../../src/events/issuance-types.ts'
import type { ReceiveRequest } from '../../src/tickets/types.ts'

// Synthetic transaction/anchor, real signatures, distinct venue and attendee keys.
export async function attendeeOfflineFixture(origin = 'http://127.0.0.1:4175', mined = true, attendeeKey = 2) {
 const venue = new ProtoWallet(new PrivateKey(1)), attendee = new ProtoWallet(new PrivateKey(attendeeKey))
 const owner = (await venue.getPublicKey({ identityKey: true })).publicKey
 const identity = (await attendee.getPublicKey({ identityKey: true })).publicKey
 const id = crypto.randomUUID(), eventId = crypto.randomUUID(), requestId = crypto.randomUUID()
 const binding = { protocolID: [2, 'counterfoil ticket receiving'] as [2, string], keyID: requestId, counterparty: 'self' }
 const request: ReceiveRequest = { kind: 'ticket-request', version: 1, network: 'testnet', requestId, recipient: { ...binding, publicKey: (await attendee.getPublicKey({ ...binding, forSelf: true })).publicKey } }
 const funding = new Transaction(1, [], [{ satoshis: 100, lockingScript: LockingScript.fromASM('OP_TRUE') }])
 funding.merklePath = new MerklePath(1762324, [[{ offset: 0, hash: funding.id('hex'), txid: true }]])
 const tx = new Transaction(1, [{ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() }], [{ satoshis: 1, lockingScript: ticketScript(eventId, id, null, request) }])
 if (mined) tx.merklePath = new MerklePath(1762324, [[{ offset: 0, hash: tx.id('hex'), txid: true }]])
 const output = { txid: tx.id('hex'), index: 0 }, data = issuanceBytes(eventId, id, output)
 const issuanceKey = { protocolID: [2, 'counterfoil ticket issuance'] as [2, string], keyID: `${output.txid}.0`, counterparty: 'anyone' }
 const context = { origin, eventId, revision: 2, venue: owner, attendee: identity, request }
 const record: VenueIssuance = {
  id, eventId, eventRevision: 2, owner, status: 'complete', txid: output.txid, request,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  event: { name: 'Harbour Nights', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Harbour Hall', address: '14 Marina Road', description: 'An evening by the water.' },
  attendeeProof: { ...context, signature: Utils.toBase64((await attendee.createSignature({ ...binding, data: requestProofBytes(context) })).signature) },
  pkg: { kind: 'ticket-package', version: 1, network: 'testnet', issuance: { eventId, ticketId: id, origin: output, issuerIdentity: owner, signedBytesBase64: Utils.toBase64(data), signatureBase64: Utils.toBase64((await venue.createSignature({ ...issuanceKey, data })).signature), signingKey: { ...issuanceKey, publicKey: (await venue.getPublicKey({ ...issuanceKey, forSelf: true })).publicKey } }, current: output, request, lineageRawTxs: [tx.toHex()], atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) },
 }
 return { record, identity, tx }
}
