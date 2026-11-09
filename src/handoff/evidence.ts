import { KeyDeriver, PublicKey, Signature, Transaction, Utils } from '@bsv/sdk'
import { readAttendeeEvidence, type AttendeeEvidence } from '../offline/attendee-evidence.ts'
import { fromBase64, identifier, MAX_PACKAGE_BYTES, publicKey, readReceiveRequest, readTicketPackage } from '../tickets/codec.ts'
import { verifyTicket } from '../verification/verifyTicket.ts'
import { decodeTicket } from '../tickets/script.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import type { Verification } from '../tickets/types.ts'
import { HANDOFF_PROTOCOL, type HandoffRequest, type HandoffTicket, type Invitation } from './types.ts'

function object(value: unknown): Record<string, unknown> {
 if (typeof value === 'string') { if (new TextEncoder().encode(value).length > MAX_PACKAGE_BYTES) throw Error('Handoff envelope exceeds 4 MiB.'); value = JSON.parse(value) }
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid handoff evidence.')
 if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_PACKAGE_BYTES) throw Error('Handoff envelope exceeds 4 MiB.')
 return value as Record<string, unknown>
}
function origin(value: unknown): string {
 if (typeof value !== 'string' || value.length > 300 || !/^https?:\/\//.test(value) || new URL(value).origin !== value) throw Error('Invalid handoff origin.')
 return value
}
function event(value: unknown): AttendeeEvidence['event'] {
 const input = object(value), out = {} as AttendeeEvidence['event']
 for (const key of ['name', 'date', 'time', 'timezone', 'venue', 'address', 'description'] as const) {
  if (typeof input[key] !== 'string' || input[key].length > 10000) throw Error('Invalid handoff event metadata.')
  out[key] = input[key]
 }
 return out
}
export function readInvitation(value: unknown): Invitation {
 const v = object(value), source = object(v.source)
 if (v.kind !== 'ticketsv-handoff-invitation' || v.version !== 1 || v.network !== 'testnet' || typeof source.txid !== 'string' || !/^[a-f0-9]{64}$/.test(source.txid) || !Number.isSafeInteger(source.index) || (source.index as number) < 0 || (source.index as number) > 0xffffffff) throw Error('Invalid handoff invitation.')
 if (v.requiredHeight !== undefined && (!Number.isSafeInteger(v.requiredHeight) || (v.requiredHeight as number) < 0 || (v.requiredHeight as number) > 1000000000)) throw Error('Invalid handoff header preparation height.')
 return { kind: v.kind, version: 1, network: 'testnet', ...(v.requiredHeight !== undefined ? { requiredHeight: v.requiredHeight as number } : {}), origin: origin(v.origin), eventId: identifier(v.eventId), ticketId: identifier(v.ticketId), source: { txid: source.txid, index: source.index as number }, trustedVenue: publicKey(v.trustedVenue), event: event(v.event) }
}
export function requestBytes(value: Pick<HandoffRequest, 'invitation' | 'recipientIdentity' | 'request'>): number[] {
 const invitation = readInvitation(value.invitation), recipientIdentity = publicKey(value.recipientIdentity), request = readReceiveRequest(JSON.stringify(value.request))
 return Utils.toArray(JSON.stringify({ purpose: 'Receive a TicketSV offline handoff', version: 1, network: 'testnet', invitation, recipientIdentity, request }), 'utf8')
}
export function readHandoffRequest(value: unknown): HandoffRequest {
 const v = object(value)
 if (v.kind !== 'ticketsv-handoff-request' || v.version !== 1) throw Error('Invalid handoff request.')
 const invitation = readInvitation(v.invitation), recipientIdentity = publicKey(v.recipientIdentity), request = readReceiveRequest(JSON.stringify(v.request))
 const data = requestBytes({ invitation, recipientIdentity, request })
 if (!Signature.fromDER(fromBase64(v.keySignature, 80)).verify(data, PublicKey.fromString(request.recipient.publicKey))) throw Error('Receiving key signature is invalid.')
 const identityKey = new KeyDeriver('anyone').derivePublicKey(HANDOFF_PROTOCOL, request.requestId, recipientIdentity)
 if (!Signature.fromDER(fromBase64(v.identitySignature, 80)).verify(data, identityKey)) throw Error('Recipient identity signature is invalid.')
 return { kind: v.kind, version: 1, invitation, recipientIdentity, request, keySignature: v.keySignature as string, identitySignature: v.identitySignature as string }
}
// The invitation source must be the immediately preceding ticket output, not an arbitrary fee input.
function checkSuccessor(ticket: HandoffTicket, request: HandoffRequest): void {
 const { invitation: i } = request, { pkg } = ticket
 if (ticket.origin !== i.origin || ticket.trustedVenue !== i.trustedVenue || ticket.holder !== request.recipientIdentity || pkg.issuance.eventId !== i.eventId || pkg.issuance.ticketId !== i.ticketId || JSON.stringify(ticket.event) !== JSON.stringify(i.event) || JSON.stringify(pkg.request) !== JSON.stringify(request.request)) throw Error('Handoff request context does not match the ticket.')
 const previousRaw = pkg.lineageRawTxs.at(-2)
 if (!previousRaw) throw Error('Handoff must contain a direct ticket successor.')
 const previous = Transaction.fromHex(previousRaw), current = Transaction.fromHex(pkg.lineageRawTxs.at(-1)!)
 const output = previous.outputs[i.source.index], decoded = output && decodeTicket(output.lockingScript)
 if (previous.id('hex') !== i.source.txid || !decoded || decoded.eventId !== i.eventId || decoded.ticketId !== i.ticketId || current.id('hex') !== pkg.current.txid || current.inputs.filter(input => input.sourceTXID === i.source.txid && input.sourceOutputIndex === i.source.index).length !== 1) throw Error('Handoff is not the direct successor of the requested ticket source.')
}
export function readHandoffTicket(value: unknown): HandoffTicket {
 const v = object(value)
 if (v.kind !== 'ticketsv-handoff-ticket' || v.version !== 1 || typeof v.savedAt !== 'string' || v.savedAt.length > 40 || !Number.isFinite(Date.parse(v.savedAt))) throw Error('Invalid saved handoff ticket.')
 const pkg = readTicketPackage(JSON.stringify(v.pkg)), trustedVenue = publicKey(v.trustedVenue)
 if (pkg.issuance.issuerIdentity !== trustedVenue) throw Error('Ticket issuer does not match its trusted venue.')
 const ticket: HandoffTicket = { kind: v.kind, version: 1, origin: origin(v.origin), holder: publicKey(v.holder), trustedVenue, event: event(v.event), pkg, request: v.request === null ? null : readHandoffRequest(v.request), savedAt: v.savedAt }
 if (v.issuanceEvidence !== undefined) ticket.issuanceEvidence = readAttendeeEvidence(v.issuanceEvidence, ticket.origin)
 if (ticket.request) {
  checkSuccessor(ticket, ticket.request)
  if (ticket.issuanceEvidence && (JSON.stringify(ticket.issuanceEvidence.pkg.issuance) !== JSON.stringify(pkg.issuance) || ticket.issuanceEvidence.pkg.lineageRawTxs[0] !== pkg.lineageRawTxs[0])) throw Error('Original issuance evidence changed.')
 } else {
  const original = ticket.issuanceEvidence
  if (!original || original.attendee !== ticket.holder || original.trustedVenue !== trustedVenue || JSON.stringify(original.pkg) !== JSON.stringify(pkg) || JSON.stringify(original.event) !== JSON.stringify(ticket.event)) throw Error('Original handoff ticket requires its unchanged validated attendee evidence.')
 }
 return ticket
}
export function fromAttendee(value: unknown): HandoffTicket {
 const v = object(value), original = readAttendeeEvidence(v, origin(v.origin))
 return readHandoffTicket({ kind: 'ticketsv-handoff-ticket', version: 1, origin: original.origin, holder: original.attendee, trustedVenue: original.trustedVenue, event: original.event, pkg: original.pkg, request: null, savedAt: original.savedAt, issuanceEvidence: original })
}
export function invitationFor(value: HandoffTicket, requiredHeight?: number): Invitation {
 const t = readHandoffTicket(value)
 return readInvitation({ kind: 'ticketsv-handoff-invitation', version: 1, network: 'testnet', origin: t.origin, eventId: t.pkg.issuance.eventId, ticketId: t.pkg.issuance.ticketId, source: t.pkg.current, trustedVenue: t.trustedVenue, event: t.event, ...(requiredHeight !== undefined ? { requiredHeight } : {}) })
}
export async function verifyHandoffTicket(value: unknown, snapshot?: HeaderSnapshot): Promise<Verification> {
 const t = readHandoffTicket(value)
 return verifyTicket(t.pkg, { trustedVenueIdentity: t.trustedVenue, expectedRequest: t.request?.request ?? t.issuanceEvidence!.proof.request, snapshot })
}
export async function receiveHandoffTicket(value: unknown, independentRequest: HandoffRequest, trustedVenue: string, snapshot?: HeaderSnapshot): Promise<HandoffTicket> {
 const request = readHandoffRequest(independentRequest), ticket = readHandoffTicket(value)
 if (request.invitation.trustedVenue !== publicKey(trustedVenue) || ticket.trustedVenue !== trustedVenue || JSON.stringify(ticket.request) !== JSON.stringify(request)) throw Error('Ticket does not match the independently saved request and trusted venue.')
 checkSuccessor(ticket, request)
 const report = await verifyHandoffTicket(ticket, snapshot)
 if (report.verdict === 'rejected' || report.checks.some(c => c.status !== 'pass' && !(c.name === 'anchors' && c.status === 'incomplete'))) throw Error('Handoff ticket verification failed: ' + report.checks.filter(c => c.status !== 'pass').map(c => c.reason).join('; '))
 return ticket
}
