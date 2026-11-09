import { Utils, type WalletInterface } from '@bsv/sdk'
import { RECEIVE_PROTOCOL } from '../tickets/types.ts'
import { readReceiveRequest } from '../tickets/codec.ts'
import { requestProofBytes, verifyRequestProof } from '../marketplace/request-proof.ts'
import type { RequestContext, RequestProof } from '../marketplace/types.ts'
import { checkVenueWallet } from './venue-issuance.ts'
export async function prepareAttendeeRequest(wallet: WalletInterface, context: RequestContext, requestId: string): Promise<RequestProof> {
 await checkVenueWallet(wallet, context.attendee)
 const key = (await wallet.getPublicKey({ protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self', forSelf: true })).publicKey
 const request = readReceiveRequest(JSON.stringify({ kind: 'ticket-request', version: 1, network: 'testnet', requestId, recipient: { publicKey: key, protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self' } }))
 const data = requestProofBytes({ ...context, request })
 await checkVenueWallet(wallet, context.attendee)
 const { signature } = await wallet.createSignature({ protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self', data })
 await checkVenueWallet(wallet, context.attendee)
 return verifyRequestProof({ ...context, request, signature: Utils.toBase64(signature) }, context)
}
