import type { VenueIssuance } from '../events/issuance-types.ts'
import { Transaction } from '@bsv/sdk'
import type { RequestProof } from '../marketplace/types.ts'
import { validUUID, verifyRequestProof } from '../marketplace/request-proof.ts'
import { fromBase64, publicKey, readTicketPackage, readReceiveRequest } from '../tickets/codec.ts'
import type { TicketPackage, Verification } from '../tickets/types.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { verifyTicket } from '../verification/verifyTicket.ts'
import { readSigningEvidenceBytes } from '../verification/signing-spv.ts'

export type AttendeeEvidence = {
 kind: 'ticketsv-attendee-offline'; version: 1; id: string; attendee: string; origin: string
 eventId: string; eventRevision: number; event: VenueIssuance['event']; trustedVenue: string
 proof: RequestProof; pkg: TicketPackage; savedAt: string
}
export function readAttendeeEvidence(value: unknown, origin: string): AttendeeEvidence {
 if (!value || typeof value !== 'object') throw Error('Invalid saved ticket.')
 const v = value as AttendeeEvidence
 if (v.kind !== 'ticketsv-attendee-offline' || v.version !== 1 || !validUUID(v.id) || !validUUID(v.eventId) || v.origin !== origin || typeof v.savedAt !== 'string' || !Number.isFinite(Date.parse(v.savedAt))) throw Error('Invalid saved ticket context.')
 const attendee = publicKey(v.attendee), trustedVenue = publicKey(v.trustedVenue)
 const proof = verifyRequestProof(v.proof, { origin, eventId: v.eventId, revision: v.eventRevision, venue: trustedVenue, attendee })
 const pkg = readTicketPackage(JSON.stringify(v.pkg))
 if (pkg.issuance.eventId !== v.eventId || pkg.issuance.ticketId !== v.id || pkg.issuance.issuerIdentity !== trustedVenue || pkg.current.txid !== pkg.issuance.origin.txid || pkg.current.index !== pkg.issuance.origin.index) throw Error('Saved ticket does not match its original delivery.')
 if (JSON.stringify(pkg.request) !== JSON.stringify(proof.request)) throw Error('Saved recipient does not match the independent receiving request.')
 const event = {} as VenueIssuance['event']
 for (const field of ['name', 'date', 'time', 'timezone', 'venue', 'address', 'description'] as const) {
  const text = v.event?.[field]
  if (typeof text !== 'string' || text.length > 10000) throw Error('Invalid saved event details.')
  event[field] = text
 }
 return { kind: v.kind, version: 1, id: v.id, attendee, origin, eventId: v.eventId, eventRevision: v.eventRevision, event, trustedVenue, proof, pkg, savedAt: v.savedAt }
}
export function attendeeEvidence(record: VenueIssuance, owner: string, origin: string): AttendeeEvidence {
 if (record.status !== 'complete' || !record.pkg || !record.attendeeProof || record.txid !== record.pkg.issuance.origin.txid) throw Error('A completed attendee delivery is required.')
 if (JSON.stringify(readReceiveRequest(JSON.stringify(record.request))) !== JSON.stringify(readReceiveRequest(JSON.stringify(record.attendeeProof.request)))) throw Error('Delivery receiving request changed.')
 return readAttendeeEvidence({ kind: 'ticketsv-attendee-offline', version: 1, id: record.id, attendee: owner, origin, eventId: record.eventId, eventRevision: record.eventRevision, event: record.event, trustedVenue: record.owner, proof: record.attendeeProof, pkg: record.pkg, savedAt: new Date().toISOString() }, origin)
}
// The server may still hold the original envelope after a mining refresh.
// Reuse only the matching device envelope; this never restores a saved verdict.
export function restoreAttendeeMiningEvidence(record: VenueIssuance, saved: unknown, owner: string, origin: string): VenueIssuance {
 const current = attendeeEvidence(record, owner, origin), previous = readAttendeeEvidence(saved, origin)
 if (previous.attendee !== owner || previous.id !== current.id || previous.eventId !== current.eventId || previous.eventRevision !== current.eventRevision || previous.trustedVenue !== current.trustedVenue || JSON.stringify({ ...previous.pkg, atomicBeefBase64: '' }) !== JSON.stringify({ ...current.pkg, atomicBeefBase64: '' })) throw Error('Saved mining evidence does not match this delivery.')
 if (Transaction.fromAtomicBEEF(fromBase64(current.pkg.atomicBeefBase64)).merklePath) return record
 const checked = readSigningEvidenceBytes(current.pkg.current.txid, fromBase64(previous.pkg.atomicBeefBase64))
 const transaction = Transaction.fromAtomicBEEF([...checked.atomicBeef])
 if (transaction.toHex() !== current.pkg.lineageRawTxs.at(-1)) throw Error('Saved mining evidence changed the ticket transaction.')
 if (!transaction.merklePath) return record
 return { ...record, pkg: { ...current.pkg, atomicBeefBase64: previous.pkg.atomicBeefBase64 } }
}
export async function verifyAttendeeEvidence(value: unknown, origin: string, snapshot?: HeaderSnapshot): Promise<Verification> {
 const evidence = readAttendeeEvidence(value, origin)
 return verifyTicket(evidence.pkg, { trustedVenueIdentity: evidence.trustedVenue, expectedRequest: evidence.proof.request, snapshot })
}
export function requireMinedEvidence(report: Verification): void {
 if (report.verdict !== 'verified') throw Error('Ticket evidence is not fully verified. Verify the ticket and resolve any failed or missing checks before saving.')
 if (!report.presentedTransferMined) throw Error('Mining inclusion is not verified. Check mining evidence, then save again.')
}
