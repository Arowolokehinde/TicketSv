import {validateEventDetails,type EventDetails} from '../events/drafts.ts'
import {publicKey,identifier} from '../tickets/codec.ts'
import {readInvitation} from './evidence.ts'
import {createStore} from './store.ts'
import type {Invitation} from './types.ts'

export type OrganiserReview={kind:'ticketsv-organiser-review';version:1;id:string;revision:number;origin:string;eventId:string;venueIdentity:string;publicationRevision:number;event:Omit<EventDetails,'image'>;reviewedAt:string;source:'ticketsv-public-event'}
export const organiserReviewKey=(invitation:Pick<Invitation,'origin'|'eventId'>)=>JSON.stringify([invitation.origin,invitation.eventId])
function details(value:unknown):OrganiserReview['event']{
 if(!value||typeof value!=='object')throw Error('Published event details are missing.')
 const {image:_image,...event}=validateEventDetails({...value,image:null} as EventDetails)
 return event
}
export function readOrganiserReview(value:unknown,previous?:OrganiserReview):OrganiserReview{
 if(!value||typeof value!=='object')throw Error('Saved organiser review is damaged.')
 const v=value as OrganiserReview
 if(v.kind!=='ticketsv-organiser-review'||v.version!==1||v.source!=='ticketsv-public-event'||!Number.isSafeInteger(v.revision)||v.revision<0||!Number.isSafeInteger(v.publicationRevision)||v.publicationRevision<1||typeof v.reviewedAt!=='string'||v.reviewedAt.length>40||!Number.isFinite(Date.parse(v.reviewedAt)))throw Error('Saved organiser review is invalid.')
 if(typeof v.origin!=='string'||!/^https?:\/\//.test(v.origin)||new URL(v.origin).origin!==v.origin||v.origin.length>300)throw Error('Saved organiser review has an invalid website address.')
 const out:OrganiserReview={kind:v.kind,version:1,source:v.source,id:v.id,revision:v.revision,origin:v.origin,eventId:identifier(v.eventId),venueIdentity:publicKey(v.venueIdentity),publicationRevision:v.publicationRevision,event:details(v.event),reviewedAt:v.reviewedAt}
 if(out.id!==organiserReviewKey(out))throw Error('Saved organiser review belongs to another event.')
 if(previous&&(out.id!==previous.id||out.venueIdentity!==previous.venueIdentity))throw Error('Organiser identity changed. Receiving is paused; the saved identity cannot be replaced automatically.')
 if(previous&&out.publicationRevision<previous.publicationRevision)throw Error('The published event revision is older than your saved review. Receiving is paused.')
 return out
}
export function assertReviewedInvitation(invitation:Invitation,value:unknown):asserts value is OrganiserReview{
 if(!value)throw Error('Review and save the published event organiser before continuing.')
 const review=readOrganiserReview(value),i=readInvitation(invitation)
 if(review.origin!==i.origin||review.eventId!==i.eventId||review.venueIdentity!==i.trustedVenue)throw Error('Organiser identity changed or this review belongs to another event. Receiving is paused.')
}
// This constructs a review candidate. Only explicit user approval persists it.
export function reviewPublishedOrganiser(invitation:Invitation,published:unknown,previous?:OrganiserReview):OrganiserReview{
 const i=readInvitation(invitation),p=published as Record<string,unknown>|null
 if(!p||p.id!==i.eventId||publicKey(p.venueIdentity)!==i.trustedVenue)throw Error('The invitation organiser does not match the published event. Receiving is paused.')
 if(previous)assertReviewedInvitation(i,previous)
 return readOrganiserReview({kind:'ticketsv-organiser-review',version:1,id:organiserReviewKey(i),revision:previous?previous.revision+1:0,origin:i.origin,eventId:i.eventId,venueIdentity:p.venueIdentity,publicationRevision:p.revision,event:details(p),reviewedAt:new Date().toISOString(),source:'ticketsv-public-event'},previous)
}
export const organiserReviewStore=createStore('organiser-reviews',readOrganiserReview)
