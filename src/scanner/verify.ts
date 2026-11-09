import {readTicketPackage,MAX_PACKAGE_BYTES} from '../tickets/codec.ts'
import {readHandoffTicket} from '../handoff/evidence.ts'
import {readAttendeeEvidence} from '../offline/attendee-evidence.ts'
import {readOrganiserReview,organiserReviewKey,type OrganiserReview} from '../handoff/organiser-review.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import type {TicketPackage,Verification} from '../tickets/types.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'

export function scannerReview(event:unknown,origin:string,previous?:OrganiserReview):OrganiserReview{
 const p=event as Record<string,unknown>|null
 if(!p)throw Error('Choose a published event first.')
 return readOrganiserReview({kind:'ticketsv-organiser-review',version:1,source:'ticketsv-public-event',
  id:organiserReviewKey({origin,eventId:String(p.id)}),revision:previous?previous.revision+1:0,
  origin,eventId:p.id,venueIdentity:p.venueIdentity,publicationRevision:p.revision,event:p,reviewedAt:new Date().toISOString()},previous)
}
export function normalizeScannerTicket(value:unknown):TicketPackage{
 const text=typeof value==='string'?value:JSON.stringify(value)
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_PACKAGE_BYTES)throw Error('Ticket file exceeds 4 MiB.')
 const v=JSON.parse(text)
 if(v?.kind==='ticket-package')return readTicketPackage(text)
 if(v?.kind==='ticketsv-handoff-ticket')return readHandoffTicket(v).pkg
 if(v?.kind==='ticketsv-attendee-offline')return readAttendeeEvidence(v,v.origin).pkg
 throw Error('Load a saved ticket, updated handoff ticket or ticket-package file. Invitations and receiving requests are not tickets.')
}
export function scannerPolicy(v:Verification):'rejected'|'incomplete'|'passes-poc-policy'|'online-check-required'{return v.verdict==='rejected'?'rejected':v.verdict==='incomplete'?'incomplete':v.presentedTransferMined?'passes-poc-policy':'online-check-required'}
export async function verifyScannerTicket(value:unknown,trust:OrganiserReview,snapshot?:HeaderSnapshot){
 const reviewed=readOrganiserReview(trust)
 let verification:Verification
 try{
  const pkg=normalizeScannerTicket(value)
  if(pkg.issuance.eventId!==reviewed.eventId)throw Error('This ticket belongs to a different event than the prepared scanner.')
  // A door checks the actual output binding, not independent buyer intent or
  // presenter key control. Attendee verification retains its stricter contract.
  verification=await verifyTicket(pkg,{trustedVenueIdentity:reviewed.venueIdentity,expectedRequest:pkg.request,snapshot})
  verification={...verification,checks:verification.checks.map(c=>c.name==='recipient'&&c.status==='pass'?{...c,reason:'Output matches the receiving key in this evidence. Presenter key control was not checked.'}:c)}
 }catch(error){verification={verdict:'rejected',checks:[{name:'continuity',status:'fail',reason:error instanceof Error?error.message.slice(0,300):'Invalid ticket evidence'}],presentedTransferMined:false,anchorHeights:[]}}
 return {policy:scannerPolicy(verification),verification}
}
