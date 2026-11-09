import { KeyDeriver, Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import { identifier, publicKey, readReceiveRequest, readTicketPackage } from '../tickets/codec.ts'
import { ISSUER_PROTOCOL, RECEIVE_PROTOCOL, type ReceiveRequest, type TicketPackage } from '../tickets/types.ts'
import { issuanceBytes, ticketScript } from '../tickets/script.ts'
import { verifyIssuer, verifyContinuity, verifyRecipient } from '../verification/authenticity.ts'
import { verifyRequestProof } from '../marketplace/request-proof.ts'
import type { RequestProof } from '../marketplace/types.ts'
import { inspectFinal } from './signing-experiment.ts'

type Reader = Pick<WalletInterface, 'getNetwork' | 'getPublicKey'>
export async function checkVenueWallet(wallet: Reader, owner: string): Promise<void> {
 if ((await wallet.getNetwork({})).network !== 'testnet') throw Error('Select testnet before issuing a ticket.')
 if ((await wallet.getPublicKey({ identityKey: true })).publicKey !== publicKey(owner)) throw Error('The wallet identity differs from your signed-in account.')
}
export async function prepareVenueRecipient(wallet: Reader, owner: string, ticketId: string): Promise<ReceiveRequest> {
 await checkVenueWallet(wallet, owner)
 const requestId = `${identifier(ticketId)}-source`
 const key = (await wallet.getPublicKey({ protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self', forSelf: true })).publicKey
 await checkVenueWallet(wallet, owner)
 return readReceiveRequest(JSON.stringify({ kind: 'ticket-request', version: 1, network: 'testnet', requestId, recipient: { publicKey: key, protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self' } }))
}
export async function issueVenueTicket(wallet: WalletInterface, owner: string, eventId: string, ticketId: string, request: ReceiveRequest, checkpoint: (txid: string) => Promise<void>): Promise<TicketPackage> {
 identifier(eventId); identifier(ticketId)
 const recipient = await prepareVenueRecipient(wallet, owner, ticketId)
 if (JSON.stringify(recipient) !== JSON.stringify(readReceiveRequest(JSON.stringify(request)))) throw Error('The reviewed receiving key changed.')
 return issueToRecipient(wallet, owner, eventId, ticketId, recipient, checkpoint, true)
}
export async function issueAttendeeTicket(wallet: WalletInterface, owner: string, eventId: string, ticketId: string, proof: RequestProof, checkpoint: (txid: string) => Promise<void>): Promise<TicketPackage> {
 identifier(ticketId)
 const checked = verifyRequestProof(proof, { eventId, venue: owner, attendee: proof.attendee, origin: proof.origin, revision: proof.revision })
 return issueToRecipient(wallet, owner, eventId, ticketId, checked.request, checkpoint, false)
}
async function issueToRecipient(wallet: WalletInterface, owner: string, eventId: string, ticketId: string, recipient: ReceiveRequest, checkpoint: (txid: string) => Promise<void>, ownRecipient: boolean): Promise<TicketPackage> {
 const script = ticketScript(eventId, ticketId, null, recipient).toHex()
 await checkVenueWallet(wallet, owner)
 const response = await wallet.createAction({ description: 'Issue TicketSV event ticket', labels: [`ticketsv-issuance-${ticketId}`], outputs: [{ lockingScript: script, satoshis: 1, outputDescription: ownRecipient ? 'TicketSV event ticket for connected wallet' : 'TicketSV event ticket for attendee', ...(ownRecipient ? { basket: 'counterfoil-ticket-experiment', customInstructions: JSON.stringify({ protocolID: RECEIVE_PROTOCOL, keyID: recipient.requestId, counterparty: 'self', type: 'PushDrop' }) } : {}) }], options: { noSend: false, acceptDelayedBroadcast: false, returnTXIDOnly: false, randomizeOutputs: false } })
 // Persist the returned ID before any more signatures. Never repeat creation.
 if (response.txid && /^[a-f0-9]{64}$/.test(response.txid)) await checkpoint(response.txid)
 const final = await inspectFinal(response, script)
 if (!response.txid) await checkpoint(final.txid)
 const origin = { txid: final.txid, index: final.outputIndex }, keyID = `${origin.txid}.${origin.index}`
 await checkVenueWallet(wallet, owner)
 const data = issuanceBytes(eventId, ticketId, origin)
 const { signature } = await wallet.createSignature({ protocolID: ISSUER_PROTOCOL, keyID, counterparty: 'anyone', data })
 await checkVenueWallet(wallet, owner)
 const pkg = readTicketPackage(JSON.stringify({ kind: 'ticket-package', version: 1, network: 'testnet', issuance: { eventId, ticketId, origin, issuerIdentity: owner, signedBytesBase64: Utils.toBase64(data), signatureBase64: Utils.toBase64(signature), signingKey: { publicKey: new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL, keyID, owner).toString(), protocolID: ISSUER_PROTOCOL, keyID, counterparty: 'anyone' } }, current: origin, request: recipient, lineageRawTxs: [Transaction.fromAtomicBEEF(final.atomicBeef).toHex()], atomicBeefBase64: Utils.toBase64(final.atomicBeef) }))
 verifyIssuer(pkg, owner); verifyContinuity(pkg); verifyRecipient(pkg, recipient)
 return pkg
}
