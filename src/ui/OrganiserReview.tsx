import {useEffect,useRef,useState} from 'react'
import {api} from '../auth/api.ts'
import type {Invitation} from '../handoff/types.ts'
import {organiserReviewKey,organiserReviewStore,assertReviewedInvitation,reviewPublishedOrganiser,type OrganiserReview as Review} from '../handoff/organiser-review.ts'
import {eventDate} from './VenueEvents.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'

export function OrganiserReview({invitation,disabled,onReviewed}:{invitation:Invitation;disabled:boolean;onReviewed:(review:Review|null)=>void}){
 const [saved,setSaved]=useState<Review>(),[candidate,setCandidate]=useState<Review>(),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[approved,setApproved]=useState(false),[error,setError]=useState('')
 const mounted=useRef(true),operation=useRef<AbortController|null>(null),notify=useRef(onReviewed)
 notify.current=onReviewed
 async function lookup(previous?:Review){
  operation.current?.abort();const controller=new AbortController();operation.current=controller
  setLoading(true);setCandidate(undefined);setApproved(false);setError('');notify.current(null)
  try{
   if(!navigator.onLine)throw Error(previous?'Reconnect to review the current publication. Your saved review is retained.':'Connect online to review this event. No saved organiser review is available for this invitation.')
   const value=await api(`/api/marketplace/events/${encodeURIComponent(invitation.eventId)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])},32768)
   controller.signal.throwIfAborted()
   const reviewed=reviewPublishedOrganiser(invitation,value,previous)
   if(mounted.current)setCandidate(reviewed)
  }catch(error){if(mounted.current&&!controller.signal.aborted)setError((error as Error).message)}
  finally{if(mounted.current&&!controller.signal.aborted)setLoading(false)}
 }
 useEffect(()=>{
  mounted.current=true;notify.current(null);setLoading(true)
  const controller=new AbortController();operation.current=controller
  void organiserReviewStore.load(organiserReviewKey(invitation)).then(async review=>{
   if(!mounted.current||controller.signal.aborted)return
   if(review){assertReviewedInvitation(invitation,review);setSaved(review);notify.current(review);setLoading(false)}
   else await lookup()
  }).catch(error=>{if(mounted.current&&!controller.signal.aborted){setError((error as Error).message);setLoading(false)}})
  return()=>{mounted.current=false;operation.current?.abort()}
 },[invitation])
 async function save(){
  if(!candidate||!approved||saving||disabled)return
  setSaving(true);setError('')
  try{
   const review={...candidate,reviewedAt:new Date().toISOString()}
   await organiserReviewStore.save(review,saved?.revision)
   if(mounted.current){setSaved(review);setCandidate(undefined);setApproved(false);notify.current(review)}
  }catch(error){if(mounted.current){setError((error as Error).message);notify.current(null)}}
  finally{if(mounted.current)setSaving(false)}
 }
 const review=candidate??saved,keys=['name','date','time','timezone','venue','address','description'] as const
 const differences=review?keys.filter(key=>review.event[key]!==invitation.event[key]):[]
 return <section className="organiser-review" aria-label="Organiser review" aria-busy={loading||saving}>
  <div className="organiser-review-heading"><DashboardIcon name="explore"/><h3>{candidate?'Review the event organiser':saved?'Saved organiser review':'Check the event organiser'}</h3></div>
  {loading&&<p role="status">Checking the published event and saved organiser review…</p>}
  {!loading&&review&&<><span className="organiser-review-label">{candidate?'Published event on this website':'Reviewed on this device'}</span><h4>{review.event.name}</h4><p>{eventDate(review.event.date)} · {review.event.time} ({review.event.timezone})<br/>{review.event.venue} · {review.event.address}</p>
   <a href={`/events/${encodeURIComponent(review.eventId)}`} target="_blank" rel="noreferrer">View public event ↗</a>
   <p className="organiser-match">Invitation matches this organiser identity.</p>
   {saved&&!candidate&&<p className="event-help">Saved {new Date(saved.reviewedAt).toLocaleString()}. This review can be used offline; it is not a fresh publication lookup.</p>}
   {differences.length>0&&<details className="organiser-differences" open><summary>The sender’s event details differ from the reviewed event</summary><ul>{differences.map(key=><li key={key}><strong>{key}:</strong> sender supplied “{invitation.event[key].slice(0,300)}”; reviewed event says “{review.event[key].slice(0,300)}”.</li>)}</ul></details>}
   <details className="organiser-identity"><summary>Organiser identity details</summary><code>{review.venueIdentity}</code><p className="event-help">Publication revision {review.publicationRevision}. Ticket issuer signatures are checked when the ticket arrives.</p></details>
   {candidate&&<><p className="event-help">TicketSV has not verified this organiser’s real-world identity. Confirm this is the event and organiser you intend to trust.</p><label className="issuance-consent"><input type="checkbox" checked={approved} disabled={disabled||saving} onChange={event=>setApproved(event.target.checked)}/>I reviewed this published event{differences.length?' and the differences shown above':''} and trust its organiser for this ticket.</label><button className="btn primary" aria-label="Save organiser review" disabled={!approved||disabled||saving} onClick={()=>void save()}>{saving?'Saving review…':'Save organiser review'}</button></>}
  </>}
  {error&&<p role="alert" className="event-error">{error}</p>}
  {!loading&&!saving&&navigator.onLine&&<button className="btn" disabled={disabled} onClick={()=>void lookup(saved)}>{candidate?'Refresh published event':saved?'Review current publication':'Retry event lookup'}</button>}
 </section>
}
