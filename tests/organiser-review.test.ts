import {expect,it} from 'vitest'
import {PrivateKey} from '@bsv/sdk'
import {reviewPublishedOrganiser,assertReviewedInvitation,readOrganiserReview} from '../src/handoff/organiser-review.ts'
import {handoffFixture} from './helpers/handoff-fixture.ts'
import {invitationFor} from '../src/handoff/evidence.ts'
async function fixture(){const f=await handoffFixture();const invitation=invitationFor(f.source,1762424);return {invitation,published:{...invitation.event,id:invitation.eventId,revision:1,venueIdentity:invitation.trustedVenue}}}
it('pins the reviewed publication to the exact website, event and organiser, independently of invitation metadata',async()=>{
 const {invitation,published}=await fixture()
 const review=reviewPublishedOrganiser(invitation,{...published,name:'Reviewed public event'})
 expect(review.event.name).toBe('Reviewed public event');expect(review.origin).toBe(invitation.origin)
 expect(()=>assertReviewedInvitation(invitation,review)).not.toThrow()
 for(const i of [{...invitation,eventId:'another-event'},{...invitation,origin:'https://different.example'},{...invitation,trustedVenue:new PrivateKey(81).toPublicKey().toString()}])expect(()=>assertReviewedInvitation(i,review)).toThrow()
})
it('rejects mismatching publications and never silently replaces a pinned identity',async()=>{
 const {invitation,published}=await fixture(),review=reviewPublishedOrganiser(invitation,published),other=new PrivateKey(81).toPublicKey().toString()
 expect(()=>reviewPublishedOrganiser(invitation,{...published,id:'another-event'})).toThrow()
 expect(()=>reviewPublishedOrganiser(invitation,{...published,venueIdentity:other})).toThrow()
 expect(()=>reviewPublishedOrganiser({...invitation,trustedVenue:other},{...published,venueIdentity:other},review)).toThrow(/changed/i)
 expect(()=>readOrganiserReview({...review,venueIdentity:other},review)).toThrow(/changed/i)
})
it('retains the saved review when the same organiser publishes updated event details',async()=>{
 const {invitation,published}=await fixture(),old=reviewPublishedOrganiser(invitation,published)
 const next=reviewPublishedOrganiser(invitation,{...published,revision:2,name:'Updated event'},old)
 expect(next.revision).toBe(old.revision+1);expect(next.publicationRevision).toBe(2)
 expect(next.venueIdentity).toBe(old.venueIdentity)
 expect(readOrganiserReview(next,old).event.name).toBe('Updated event')
})
it('rejects invitation-derived review claims, damaged records and older publications',async()=>{
 const {invitation,published}=await fixture(),saved=reviewPublishedOrganiser(invitation,{...published,revision:2})
 expect(()=>readOrganiserReview({...saved,source:'invitation'})).toThrow()
 expect(()=>readOrganiserReview({...saved,id:'another-record'})).toThrow()
 expect(()=>reviewPublishedOrganiser(invitation,published,saved)).toThrow(/older/)
})
