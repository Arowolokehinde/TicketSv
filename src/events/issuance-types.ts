import type { RequestProof } from '../marketplace/types.ts'
import type { ReceiveRequest, TicketPackage } from '../tickets/types.ts'
export type VenueIssuance = {
 id: string; eventId: string; owner: string; eventRevision: number
 event: { name: string; date: string; time: string; timezone: string; venue: string; address: string; description: string }
 attendeeRequestId?: string | null; attendeeProof?: RequestProof; request: ReceiveRequest; status: 'prepared' | 'pending' | 'complete'
 txid: string | null; pkg: TicketPackage | null; createdAt: string; updatedAt: string
}
