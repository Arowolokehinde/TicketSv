import type { AttendeeEvidence } from '../offline/attendee-evidence.ts'
import type { KeyBinding, Outpoint, ReceiveRequest, TicketPackage } from '../tickets/types.ts'
import type { ArcObservation, ArcPolicy } from '../settlement/types.ts'

export const HANDOFF_PROTOCOL: [2, string] = [2, 'ticketsv handoff requests']
export type Invitation = { kind: 'ticketsv-handoff-invitation'; version: 1; network: 'testnet'; origin: string; eventId: string; ticketId: string; source: Outpoint; trustedVenue: string; event: AttendeeEvidence['event']; requiredHeight?: number }
export type HandoffRequest = { kind: 'ticketsv-handoff-request'; version: 1; invitation: Invitation; recipientIdentity: string; request: ReceiveRequest; keySignature: string; identitySignature: string }
export type HandoffTicket = { kind: 'ticketsv-handoff-ticket'; version: 1; origin: string; holder: string; trustedVenue: string; event: AttendeeEvidence['event']; pkg: TicketPackage; request: HandoffRequest | null; savedAt: string; issuanceEvidence?: AttendeeEvidence }
export type Funding = { key: KeyBinding; amount: number; policy: ArcPolicy; txid?: string; beef?: string; index?: number; observation?: ArcObservation; rawReceipt?: unknown }
export type Attempt = { id: string; outcome: 'pending' | 'complete' | 'unknown'; startedAt: string; finishedAt?: string }
export type SenderRecord = { kind: 'ticketsv-handoff-sender'; version: 1; id: string; revision: number; ticket: HandoffTicket; funding?: Funding; fundAttempt?: Attempt; signAttempt?: Attempt; request?: HandoffRequest; transfer?: HandoffTicket }
export type RecipientRecord = { kind: 'ticketsv-handoff-recipient'; version: 1; id: string; revision: number; request: HandoffRequest; ticket?: HandoffTicket }
export type RecordStore<T extends { id: string; revision: number }> = { load(id: string): Promise<T | undefined>; list(): Promise<T[]>; save(next: T, expectedRevision: number | undefined): Promise<void> }
