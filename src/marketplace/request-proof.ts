import { PublicKey, Signature, Utils } from '@bsv/sdk'
import { fromBase64, publicKey, readReceiveRequest } from '../tickets/codec.ts'
import type { RequestContext, RequestProof } from './types.ts'
export const validUUID = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
export function requestProofBytes(value: RequestContext & { request: RequestProof['request'] }): number[] {
 if (!validUUID(value.eventId) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.origin !== 'string' || value.origin.length > 300 || new URL(value.origin).origin !== value.origin) throw Error('Invalid event request context.')
 const request = readReceiveRequest(JSON.stringify(value.request))
 if (!validUUID(request.requestId)) throw Error('Invalid receiving request ID.')
 return Utils.toArray(JSON.stringify({ purpose: 'Request a TicketSV event ticket', version: 1, network: 'testnet', origin: value.origin, eventId: value.eventId, revision: value.revision, venue: publicKey(value.venue), attendee: publicKey(value.attendee), request }), 'utf8')
}
export function verifyRequestProof(value: RequestProof, expected: RequestContext): RequestProof {
 for (const key of ['eventId', 'revision', 'venue', 'attendee', 'origin'] as const) if (value[key] !== expected[key]) throw Error('Receiving request context changed.')
 const request = readReceiveRequest(JSON.stringify(value.request))
 const proof = { ...expected, request, signature: value.signature }
 if (!Signature.fromDER(fromBase64(proof.signature, 80)).verify(requestProofBytes(proof), PublicKey.fromString(request.recipient.publicKey))) throw Error('Receiving key signature is invalid.')
 return proof
}
