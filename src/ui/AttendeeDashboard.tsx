import {synchroniseReceivedTickets,restoreReceivedArchive} from '../handoff/sync.ts'
import {ExchangeImport} from './HandoffExchange.tsx'
import { headerProgressText, SHARED_HEADER_TRUST, SHARED_HEADERS_ENABLED } from '../headers/cached-sync.ts'
import { useEffect, useRef, useState } from 'react'
import { api, currentAuthEpoch, currentAuthIdentity } from '../auth/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { AttendeeRequest, AttendeeTicket } from '../marketplace/types.ts'
import type { VenueIssuance } from '../events/issuance-types.ts'
import type { Verification } from '../tickets/types.ts'
import type { HeaderSyncProgress } from '../headers/sync.ts'
import {recipientStore} from '../handoff/store.ts'
import {settlementStore,type HandoffSettlement} from '../handoff/settlement.ts'
import type {HandoffTicket} from '../handoff/types.ts'
import { SaveOfflineTicket } from './SaveOfflineTicket.tsx'
import { PrepareTicketWallet } from './PrepareTicketWallet.tsx'
import { eventDate } from './VenueEvents.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'
import '../styles/marketplace.css'

type DashboardHandoff={ticket:HandoffTicket;settlement?:HandoffSettlement;href:string}
const requestStatus = { requested: 'Waiting for organiser approval', prepared: 'Organiser reviewing issuance', pending: 'Issuance in progress or awaiting review', complete: 'Ticket delivered' }
export function AttendeeDashboard() {
 const { session } = useAuth(), owner = session!.identityKey
 const [tickets, setTickets] = useState<AttendeeTicket[]>([]), [requests, setRequests] = useState<AttendeeRequest[]>([])
 const [handoffs,setHandoffs]=useState<DashboardHandoff[]>([]),[handoffError,setHandoffError]=useState('')
 const [ticketNext, setTicketNext] = useState<number | null>(null), [requestNext, setRequestNext] = useState<number | null>(null)
 const [selected, setSelected] = useState<VenueIssuance>(), [report, setReport] = useState<Verification>(), [progress, setProgress] = useState<HeaderSyncProgress>()
 const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false)
 const active = useRef<AbortController | null>(null), mounted = useRef(true), walletOperation = useRef(false)
 async function perform(action: (signal: AbortSignal, check: () => void) => Promise<void>, usesWallet = false) {
  if (active.current) return
  const controller = new AbortController(), epoch = currentAuthEpoch(); active.current = controller; walletOperation.current = usesWallet; setBusy(true); setError(''); setNotice(''); setProgress(undefined)
  const check = () => { controller.signal.throwIfAborted(); if (!mounted.current || currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner) throw Error('The signed-in account changed. Reopen your Dashboard.') }
  try { await action(controller.signal, check) }
  catch (e) { if (mounted.current && active.current === controller) setError((e as Error).message) }
  finally { if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false) } controller.abort() }
 }
 async function reload() {
  await perform(async (signal, check) => {
   // Handoff evidence is saved on this device, separately from original
   // server deliveries. Load it even when the delivery API is unavailable.
   try {
    const [received,settled]=await Promise.all([recipientStore.list(),settlementStore.list()]);check()
    const local=new Map<string,DashboardHandoff>()
    const matches=(t:HandoffTicket)=>t.holder===owner && !!t.request
    const key=(t:HandoffTicket)=>`${t.pkg.current.txid}.${t.pkg.current.index}`
    for(const r of received)if(r.ticket && matches(r.ticket))local.set(key(r.ticket),{ticket:r.ticket,href:`/offline/handoff?request=${encodeURIComponent(r.id)}`})
    // The settlement carries the latest mining package and wallet observations.
    // It may also exist without a recipient record on this browser.
    for(const r of settled)if(matches(r.ticket))local.set(key(r.ticket),{ticket:r.ticket,settlement:r,href:`/offline/handoff?transfer=${encodeURIComponent(r.id)}`})
    setHandoffs([...local.values()].sort((a,b)=>Date.parse(b.ticket.savedAt)-Date.parse(a.ticket.savedAt)));setHandoffError('')
   }catch(error){check();setHandoffs([]);setHandoffError(`Received handoffs could not be loaded: ${(error as Error).message}`)}
   if(navigator.onLine)try{
    await synchroniseReceivedTickets(owner,signal,{recipients:recipientStore,settlements:settlementStore,request:api,check});check()
    const synced=await settlementStore.list();check()
    setHandoffs(synced.filter(r=>r.ticket.holder===owner&&r.ticket.request).map(r=>({ticket:r.ticket,settlement:r,href:`/offline/handoff?transfer=${encodeURIComponent(r.id)}`})))
   }catch(syncError){check();setNotice(`Account synchronisation needs attention: ${(syncError as Error).message} Device copies are retained.`)}
   const [collection, inbox] = await Promise.all([
    api<{ tickets: AttendeeTicket[]; nextOffset: number | null }>('/api/tickets', { signal }),
    api<{ requests: AttendeeRequest[]; nextOffset: number | null }>('/api/tickets/requests', { signal }),
   ]); check()
   setTickets(collection.tickets); setTicketNext(collection.nextOffset); setRequests(inbox.requests); setRequestNext(inbox.nextOffset); setLoaded(true)
  })
 }
 useEffect(() => { mounted.current = true; void reload(); const reconnect=()=>{if(navigator.onLine)void reload()};addEventListener('online',reconnect);addEventListener('focus',reconnect);return () => { mounted.current = false; active.current?.abort(); active.current = null;removeEventListener('online',reconnect);removeEventListener('focus',reconnect) } }, [])
 function more(kind: 'tickets' | 'requests') {
  const offset = kind === 'tickets' ? ticketNext : requestNext
  if (offset === null) return
  void perform(async (signal, check) => {
   if (kind === 'tickets') { const result = await api<{ tickets: AttendeeTicket[]; nextOffset: number | null }>(`/api/tickets?offset=${offset}`, { signal }); check(); setTickets(items => [...items, ...result.tickets.filter(t => !items.some(i => i.id === t.id))]); setTicketNext(result.nextOffset) }
   else { const result = await api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/tickets/requests?offset=${offset}`, { signal }); check(); setRequests(items => [...items, ...result.requests.filter(t => !items.some(i => i.id === t.id))]); setRequestNext(result.nextOffset) }
  })
 }
 async function recoverReceived(value:unknown){
  await perform(async(signal,check)=>{
   const archive=value&&typeof value==='object'&&'ticket' in value?value:{ticket:value}
   await restoreReceivedArchive(archive,owner,{recipients:recipientStore,settlements:settlementStore,request:api,check});check()
   const saved=await settlementStore.list();check()
   setHandoffs(saved.filter(r=>r.ticket.holder===owner&&r.ticket.request).map(r=>({ticket:r.ticket,settlement:r,href:`/offline/handoff?transfer=${encodeURIComponent(r.id)}`})))
   await synchroniseReceivedTickets(owner,signal,{recipients:recipientStore,settlements:settlementStore,request:api,check});check()
   setNotice('Received ticket saved locally and synchronised. Open it for a fresh verification and wallet check.')
  })
 }
 function open(id: string) {
  void perform(async (signal, check) => {
   let record = await api<VenueIssuance>(`/api/tickets/${id}`, { signal }); check()
   const { verifyRequestProof } = await import('../marketplace/request-proof.ts'); check()
   if (!record.attendeeProof) throw Error('The independently saved receiving request is missing.')
   const attendeeProof = record.attendeeProof
   verifyRequestProof(attendeeProof, { eventId: record.eventId, revision: record.eventRevision, venue: record.owner, attendee: owner, origin: location.origin })
   try {
    const { listSavedTickets } = await import('../offline/attendee-store.ts')
    const { restoreAttendeeMiningEvidence } = await import('../offline/attendee-evidence.ts'); check()
    const saved = (await listSavedTickets(location.origin)).find(row => row.evidence?.id === record.id && row.evidence.attendee === owner)
    check()
    if (saved?.evidence) record = restoreAttendeeMiningEvidence(record, saved.evidence, owner, location.origin)
   } catch {
    // Missing, inaccessible or mismatched device data must not prevent access
    // to the authenticated delivery. Fresh verification still runs below.
    check()
   }
   setSelected(record); setReport(undefined)
   if (SHARED_HEADERS_ENABLED && record.pkg && navigator.onLine) {
    const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts'); check()
    const prepared = await verifyVenueTicket(record.pkg, { trustedVenueIdentity: attendeeProof.venue, expectedRequest: attendeeProof.request, online: true, signal, onProgress: p => { check(); setProgress(p) } }); check()
    if (prepared.verdict === 'verified') setNotice('Verification data is available on this device. Select Verify ticket for a fresh result.')
    else setNotice('Preparation needs attention. Select Verify ticket to see the checks.')
   }
  })
 }
 function verify() {
  if (!selected?.pkg || !selected.attendeeProof) return
  setReport(undefined)
  void perform(async (signal, check) => {
   const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts'); check()
   const result = await verifyVenueTicket(selected.pkg!, { trustedVenueIdentity: selected.attendeeProof!.venue, expectedRequest: selected.attendeeProof!.request, online: navigator.onLine, signal, onProgress: p => { check(); setProgress(p) } }); check(); setReport(result)
  })
 }
 function mining() {
  if (!selected?.pkg || !selected.attendeeProof) return
  setReport(undefined)
  void perform(async (signal, check) => {
   const { fetchStatus } = await import('../settlement/arc.ts'), { minedCandidate } = await import('../settlement/evidence.ts'); check()
   const observed = await fetchStatus(selected.pkg!.current.txid, signal); check()
   if (!observed || !['MINED', 'IMMUTABLE'].includes(observed.txStatus)) { setNotice(`Mining proof is not available from the provider yet${observed ? ` (${observed.txStatus})` : ''}. Check again later.`); return }
   const candidate = minedCandidate({ kind: 'counterfoil-reopening-evidence', version: 1, trusted: selected.owner, buyer: selected.attendeeProof!.request, pkg: selected.pkg! }, observed)
   // Retain the mined envelope before preparation: a temporary header failure
   // must never discard it or require another provider/issuance operation.
   setSelected({ ...selected, pkg: candidate.pkg }); setNotice('Mining evidence loaded for this session. Verify ticket to check it against local headers.')
   if(SHARED_HEADERS_ENABLED && navigator.onLine){
    const {verifyVenueTicket}=await import('../events/verify-venue-ticket.ts');check()
    const prepared=await verifyVenueTicket(candidate.pkg,{trustedVenueIdentity:selected.attendeeProof!.venue,expectedRequest:selected.attendeeProof!.request,online:true,signal,onProgress:p=>{check();setProgress(p)}});check()
    setNotice(prepared.verdict==='verified'?'Mining evidence loaded and verification data is ready on this device. Select Verify ticket for a fresh local result.':'Mining evidence loaded for this session. Select Verify ticket to review the remaining checks.')
   }
  })
 }
 return <div className="attendee-dashboard">
 <section className="dashboard-welcome" aria-labelledby="dashboard-welcome-title">
  <div className="dashboard-welcome-copy">
   <span className="dashboard-eyebrow"><DashboardIcon name="sparkle"/> YOUR TICKETS</span>
   <h1 id="dashboard-welcome-title">Good times. <em>Great memories.</em></h1>
   <p>A place for your tickets. A little anticipation for what comes next.</p>
   <div className="actions dashboard-welcome-actions">
    <a className="btn primary" href="/events">Explore events <DashboardIcon name="arrow"/></a>
    <a className="btn dashboard-saved-link" href="/offline/tickets" aria-disabled={busy} onClick={event=>{if(busy)event.preventDefault()}}><DashboardIcon name="saved"/> Saved tickets</a>
   </div>
  </div>
  <div className="dashboard-welcome-art" aria-hidden="true">
   <span className="dashboard-art-orbit"/>
   <DashboardIcon name="sparkle" className="dashboard-art-sparkle"/>
   <div className="dashboard-art-pass"><span>TicketSV <DashboardIcon name="ticket"/></span><strong>Go make<br/>a memory.</strong><div className="dashboard-art-perforation"/><small>THE NEXT CHAPTER IS YOURS</small><div className="dashboard-art-bars"/></div>
   <span className="dashboard-art-caption">LESS SCROLLING. MORE LIVING.</span>
  </div>
 </section>
 <div className="dashboard-collection-heading">
  <div><h2>Your collection <span>{tickets.length+handoffs.length}</span></h2><p>Original deliveries and handoffs, together in one place.</p></div>
  <button className="dashboard-refresh" aria-label="Refresh dashboard" disabled={busy} onClick={()=>void reload()}><DashboardIcon name="refresh" className={busy?'is-refreshing':''}/><span>Refresh</span></button>
 </div>
 {loaded && !handoffError && !tickets.length && !handoffs.length && <div className="event-empty dashboard-empty"><DashboardIcon name="ticket"/><h3>Your first ticket starts with an event.</h3><p>Find something you love. Once the organiser issues your ticket, it appears here.</p><a href="/events">Find your next experience <DashboardIcon name="arrow"/></a></div>}
 <div className="dashboard-tickets">
 {tickets.map(ticket=><article className="dashboard-ticket" key={ticket.id}>
  <div className="dashboard-ticket-art dashboard-ticket-art-issued"><div className="dashboard-ticket-art-top"><span className="dashboard-ticket-type">Ticket received</span><DashboardIcon name="ticket"/></div><h3>{ticket.event.name}</h3><span className="dashboard-ticket-wordmark">TicketSV / EXPERIENCE SOMETHING</span></div>
  <div className="dashboard-ticket-body"><div className="dashboard-ticket-meta"><p><DashboardIcon name="calendar"/>{eventDate(ticket.event.date)} · {ticket.event.time}</p><p><DashboardIcon name="pin"/>{ticket.event.venue}</p></div><p className="dashboard-ticket-note">Delivered to your account. Open your ticket to check its latest evidence.</p><button className="btn dashboard-ticket-open" disabled={busy} onClick={()=>open(ticket.id)}>View ticket <DashboardIcon name="arrow"/></button></div>
 </article>)}
 {handoffs.map(({ticket,settlement,href})=><article className="dashboard-ticket" key={`handoff:${ticket.pkg.current.txid}.${ticket.pkg.current.index}`}>
  <div className="dashboard-ticket-art"><div className="dashboard-ticket-art-top"><span className="dashboard-ticket-type">Received handoff</span><DashboardIcon name="ticket"/></div><h3>{ticket.event.name}</h3><span className="dashboard-ticket-wordmark">TicketSV / PASS IT FORWARD</span></div>
  <div className="dashboard-ticket-body">
   <div className="dashboard-ticket-meta"><p><DashboardIcon name="calendar"/>{eventDate(ticket.event.date)} · {ticket.event.time}</p><p><DashboardIcon name="pin"/>{ticket.event.venue}</p></div>
   <div className="dashboard-ticket-status">
    <p className={settlement?.import?.outcome==='complete'?'record-positive':''}>Import response: {settlement?.import?.outcome==='complete'?'accepted':settlement?.import?.outcome??'not attempted on this device'}</p>
    <p className={settlement?.wallet?.state==='present'?'record-positive':''}>Wallet record: {settlement?.wallet?.state??'not checked'}</p>
    {settlement?.wallet?.reason.startsWith('Reported on another device: ')&&<small>Historical wallet report. Recheck the receiving wallet for a fresh observation.</small>}
    {settlement?.wallet&&<small>Last checked {new Date(settlement.wallet.checkedAt).toLocaleString()}</small>}
   </div>
   <p className="dashboard-ticket-note">Saved on this device for your receiving wallet.</p>
   <a className="btn dashboard-ticket-open" href={href}>View received ticket <DashboardIcon name="arrow"/></a>
  </div>
 </article>)}
 </div>
 <details><summary>Recover an existing received ticket</summary><p>Load the updated ticket file from your earlier transfer. Its signed recipient must match this account. This saves evidence without publishing or importing it into a wallet.</p><ExchangeImport label="existing received ticket" disabled={busy} onLoad={recoverReceived}/></details>
 {handoffError&&<p className="event-error" role="alert">{handoffError}</p>}
 {ticketNext !== null && <button className="btn" disabled={busy} onClick={() => more('tickets')}>More tickets</button>}
 {selected?.pkg && <section className="issuance-review" aria-label="Selected ticket"><div className="event-editor-heading"><h2>{selected.event.name}</h2><button className="btn" disabled={busy} onClick={() => { setSelected(undefined); setReport(undefined) }}>Close ticket</button></div><p>{selected.event.date} · {selected.event.time} ({selected.event.timezone})<br />{selected.event.venue}</p><p>Ticket evidence is saved to your account. Mining verification, wallet import and offline preparation are separate steps.</p>
 <div className="actions"><button className="btn" disabled={busy} onClick={mining}>Check mining evidence</button><button className="btn primary" aria-label="Verify ticket" disabled={busy} onClick={verify}>Verify ticket</button></div><p className="event-help">{SHARED_HEADERS_ENABLED ? <>Opening a ticket prepares missing headers while online. {SHARED_HEADER_TRUST}</> : 'Verification downloads missing headers while online.'} Save a verified mined ticket below to reopen its evidence offline.</p>
 <SaveOfflineTicket key={selected.id + selected.pkg.atomicBeefBase64} record={selected} owner={owner} busy={busy} perform={perform} onProgress={setProgress} />
 <PrepareTicketWallet key={'prepare-' + selected.id + selected.pkg.atomicBeefBase64} record={selected} owner={owner} busy={busy} perform={action => perform(action, true)} onProgress={setProgress} />
 <details className="wallet-advanced"><summary>Ticket and recipient details</summary><p>Ticket ID: <code>{selected.id}</code></p><p>Outpoint: <code>{selected.pkg.current.txid}.{selected.pkg.current.index}</code></p><p>Receiving key: <code>{selected.request.recipient.publicKey}</code></p></details>
 {report && <div className="issuance-report"><h3>Ticket verification: {report.verdict}</h3><ul>{report.checks.map(item => <li key={item.name}>{item.name}: {item.status} — {item.reason}</li>)}</ul><p>{report.presentedTransferMined ? 'Mining inclusion verified against the saved local snapshot.' : 'Mining inclusion has not been verified.'} Local verification server contacts: 0.</p><p className="event-help">Local headers retain checkpoint and difficulty-validation limits. This does not establish current unspentness or admission.</p></div>}
 </section>}
 {requests.length > 0 && <section className="venue-inbox"><h2>Your requests</h2><div className="request-list">{requests.map(request => <article key={request.id}><div><h3>{request.event.name}</h3><p>{requestStatus[request.status]}</p><p className="event-help">Requested {new Date(request.createdAt).toLocaleDateString()} · Event revision {request.event.revision}</p></div>{request.status === 'complete' && request.ticketId ? <button className="btn" disabled={busy} onClick={() => open(request.ticketId!)}>View ticket</button> : <a href={`/events/${request.eventId}`}>Event details ↗</a>}</article>)}</div>{requestNext !== null && <button className="btn" disabled={busy} onClick={() => more('requests')}>More requests</button>}</section>}
 {busy && <p role="status">{progress ? headerProgressText(progress) : 'Loading or checking your evidence…'} <button className="btn" onClick={() => active.current?.abort(Error(walletOperation.current ? 'Operation cancelled. Cancelling does not undo a wallet action. Review its saved outcome before trying again.' : 'Operation cancelled. No wallet action was made.'))}>Cancel</button></p>}{notice && <p className="event-saved" role="status">{notice}</p>}{error && <p className="event-error" role="alert">{error}</p>}
 </div>
}
