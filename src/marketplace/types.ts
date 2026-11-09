import type { ReceiveRequest } from '../tickets/types.ts'
import type { VenueIssuance } from '../events/issuance-types.ts'
export type PublishedEvent = VenueIssuance['event'] & { id: string; revision: number; venueIdentity: string; coverUrl?: string; requestsOpen?: boolean }
export type RequestContext = { eventId: string; revision: number; venue: string; attendee: string; origin: string }
export type RequestProof = RequestContext & { request: ReceiveRequest; signature: string }
export type AttendeeRequest = { id: string; eventId: string; event: PublishedEvent; proof: RequestProof; createdAt: string; ticketId: string | null; status: 'requested' | 'prepared' | 'pending' | 'complete' }
export type AttendeeTicket = Omit<VenueIssuance, 'pkg'>
