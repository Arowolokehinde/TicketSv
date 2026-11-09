import {ReceivedSync} from './ReceivedSync.tsx'
import {recipientStore} from '../handoff/store.ts'
import type {RecipientRecord} from '../handoff/types.ts'
import { useEffect, useRef, useState } from 'react'
import { listSavedTickets, removeSavedTicket, type SavedTicket } from '../offline/attendee-store.ts'
import { verifyAttendeeEvidence } from '../offline/attendee-evidence.ts'
import { loadSnapshot } from '../headers/store.ts'
import {DashboardIcon} from './DashboardIcon.tsx'
import {eventDate} from './VenueEvents.tsx'
import type { Verification } from '../tickets/types.ts'
import '../styles/offline-tickets.css'

// Deliberately outside AuthProvider: saved public evidence needs no live session.
export function SavedTickets() {
 const [received,setReceived]=useState<RecipientRecord[]>([])
 const [rows, setRows] = useState<SavedTicket[]>([]), [selected, setSelected] = useState<SavedTicket>()
 const [report, setReport] = useState<Verification>(), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
 const [busy, setBusy] = useState(false), [removing, setRemoving] = useState<string>()
 const active = useRef(false), mounted = useRef(true)
 async function refresh() { const [saved,received]=await Promise.all([listSavedTickets(location.origin),recipientStore.list()]); if (mounted.current) { setRows(saved);setReceived(received.filter(r=>!!r.ticket)); setLoaded(true) } }
 useEffect(() => {
  mounted.current = true; void refresh().catch(e => setError((e as Error).message))
  return () => { mounted.current = false }
 }, [])
 async function run(action: () => Promise<void>) {
  if (active.current) return
  active.current = true; setBusy(true); setError('')
  try { await action() } catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { active.current = false; if (mounted.current) setBusy(false) }
 }
 function verify() {
  if (!selected?.evidence) return
  setReport(undefined)
  void run(async () => {
   // Read the record and snapshot afresh rather than trusting an earlier UI verdict.
   const latest = (await listSavedTickets(location.origin)).find(row => row.id === selected.id)
   if (!latest?.evidence) throw Error('This device copy is missing or damaged. Save it again from Dashboard while online.')
   const result = await verifyAttendeeEvidence(latest.evidence, location.origin, await loadSnapshot())
   if (mounted.current) { setSelected(latest); setReport(result) }
  })
 }
 function remove(row: SavedTicket) {
  void run(async () => { await removeSavedTicket(row); if (mounted.current) { if (selected?.id === row.id) { setSelected(undefined); setReport(undefined) }; setRemoving(undefined) }; await refresh() })
 }
 return <div className="offline-library saved-library">
 
 <main id="main" className="offline-content">
 <ReceivedSync onRestored={refresh}/><div className="saved-library-collection"><div><h1>On this device <span>{rows.length+received.length}</span></h1><p>Open a ticket to check its saved evidence.</p></div><span className="saved-library-local"><DashboardIcon name="saved"/> Device copies</span></div>
 {loaded && !rows.length && !received.length && <div className="event-empty saved-library-empty"><DashboardIcon name="ticket"/><h2>No tickets saved on this device.</h2><p>While online, open a ticket in Dashboard and select Save for offline use.</p><a className="btn primary" href="/tickets">Open Dashboard <DashboardIcon name="arrow"/></a></div>}
 <div className="offline-ticket-grid saved-library-grid">
 {rows.map(row=><article className={`offline-ticket-card saved-library-card${row.error?' saved-library-card-damaged':''}`} key={row.id}>
  <div className="saved-card-face"><div className="saved-card-face-top"><span className="saved-card-label">{row.error?'Needs attention':'Device copy'}</span><DashboardIcon name="ticket"/></div><h2>{row.evidence?.event.name??'Unreadable ticket'}</h2><small>TicketSV / SAVED WITH YOU</small></div>
  <div className="saved-card-body">
   {row.evidence&&<><div className="saved-card-meta"><p><DashboardIcon name="calendar"/>{eventDate(row.evidence.event.date)} · {row.evidence.event.time}</p><p><DashboardIcon name="pin"/>{row.evidence.event.venue}</p></div><p className="saved-card-note">Saved {new Date(row.evidence.savedAt).toLocaleString()}</p><details className="saved-card-account"><summary>Saved account</summary><code>{row.evidence.attendee}</code></details></>}
   {row.error&&<p className="saved-card-error" role="alert">{row.error}</p>}
   <div className="actions saved-card-actions">{row.evidence&&<button className="btn primary" aria-label="Open ticket" disabled={busy} onClick={()=>{setSelected(row);setReport(undefined);setError('')}}>Open ticket <DashboardIcon name="arrow"/></button>}<button className="saved-card-remove" disabled={busy} onClick={()=>setRemoving(row.id)}>Remove from this device</button></div>
   {removing===row.id&&<div className="offline-remove"><p>Remove only this device copy? Your account and wallet records stay unchanged.</p><button className="btn" disabled={busy} onClick={()=>remove(row)}>Confirm removal</button><button className="btn" disabled={busy} onClick={()=>setRemoving(undefined)}>Keep ticket</button></div>}
  </div>
 </article>)}
 {received.map(row=><article className="offline-ticket-card saved-library-card" key={row.id}>
  <div className="saved-card-face saved-card-face-handoff"><div className="saved-card-face-top"><span className="saved-card-label">Received handoff</span><DashboardIcon name="ticket"/></div><h2>{row.ticket!.event.name}</h2><small>TicketSV / PASS IT FORWARD</small></div>
  <div className="saved-card-body"><div className="saved-card-meta"><p><DashboardIcon name="calendar"/>{eventDate(row.ticket!.event.date)} · {row.ticket!.event.time}</p><p><DashboardIcon name="pin"/>{row.ticket!.event.venue}</p></div><p className="saved-card-evidence"><DashboardIcon name="saved"/> Saved on this device</p><p className="saved-card-note">Saved evidence. Verify again for its current local result.</p><a className="btn primary saved-card-open" href={`/offline/handoff?request=${encodeURIComponent(row.id)}`}>Open received ticket <DashboardIcon name="arrow"/></a></div>
 </article>)}
 </div>
 {selected?.evidence && <section className="issuance-review" aria-label="Saved ticket details"><div className="event-editor-heading"><h2>{selected.evidence.event.name}</h2><button className="btn" disabled={busy} onClick={() => { setSelected(undefined); setReport(undefined) }}>Close ticket</button></div><p>Evidence saved on this device. Verify again for a fresh result.</p><button className="btn primary" aria-label="Verify locally" disabled={busy} onClick={verify}>Verify locally</button>
 {report && <div className="issuance-report" aria-live="polite"><h3>Saved ticket verification: {report.verdict}</h3><ul>{report.checks.map(check => <li key={check.name}>{check.name}: {check.status} — {check.reason}</li>)}</ul><p>{report.presentedTransferMined ? 'Mining inclusion verified against saved local headers.' : 'Mining inclusion is not verified in this result.'} Local verification server contacts: 0.</p>{report.verdict === 'incomplete' && <p>Return to Dashboard while online and save this ticket again to prepare missing evidence.</p>}</div>}
 <details className="wallet-advanced"><summary>Ticket details and verification limits</summary><p>Account: <code>{selected.evidence.attendee}</code></p><p>Ticket: <code>{selected.evidence.id}</code></p><p>Outpoint: <code>{selected.evidence.pkg.current.txid}.{selected.evidence.pkg.current.index}</code></p><p>Venue: <code>{selected.evidence.trustedVenue}</code></p><p>Event details are the saved review snapshot. The venue signature binds the event ID, ticket ID and original output. Header checks retain checkpoint and difficulty-validation limits; mining inclusion does not establish current unspentness or admission.</p></details><p className="event-help">Open Send / Receive to prepare transfer fees and hand off your ticket. Saving evidence alone does not prepare your wallet for signing.</p></section>}
 {busy && <p role="status">Checking local evidence…</p>}{error && <p className="event-error" role="alert">{error}</p>}
 </main></div>
}
