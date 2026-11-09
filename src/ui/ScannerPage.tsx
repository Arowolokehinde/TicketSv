import {useOptionalAuth} from '../auth/AuthProvider.tsx'
import {api,currentAuthEpoch} from '../auth/api.ts'
import {savedScannerPermit,saveScannerPermit} from '../scanner/authorization.ts'
import {useEffect,useRef,useState} from 'react'
import {ExchangeImport} from './HandoffExchange.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'
import {scannerReview,normalizeScannerTicket,verifyScannerTicket} from '../scanner/verify.ts'
import {scannerSetupStore,scannerEvidenceStore,type ScannerSetup} from '../scanner/store.ts'
import {prepareScannerHeaders,scannerJSON} from '../scanner/headers.ts'
import {prepareScannerApp,scannerCacheStatus} from '../scanner/cache.ts'
import {organiserReviewStore,organiserReviewKey} from '../handoff/organiser-review.ts'
import {loadSnapshot} from '../headers/store.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import type {TicketPackage} from '../tickets/types.ts'
import type {PublishedEvent} from '../marketplace/types.ts'

type Result=Awaited<ReturnType<typeof verifyScannerTicket>>
const labels={rejected:'Ticket rejected',incomplete:'Verification incomplete','online-check-required':'Online check required','passes-poc-policy':'Passes POC door policy'}
export function ScannerPage(){
 const auth=useOptionalAuth(),[accessExpires,setAccessExpires]=useState(()=>savedScannerPermit()?.expiresAt)
 async function authoriseOffline(signal:AbortSignal){
  if(!auth?.session)throw Error('Sign in before preparing offline scanner access.')
  const identity=auth.session.identityKey
  try{const permit=await api('/api/auth/scanner-permit',{method:'POST',body:'{}',signal,headers:{'x-ticketsv-identity':identity}});signal.throwIfAborted();return saveScannerPermit(permit,identity)}
  catch(error){if((error as {status?:number}).status===401)dispatchEvent(new CustomEvent('ticketsv-session-expired',{detail:currentAuthEpoch()}));throw error}
 }
 const [setup,setSetup]=useState<ScannerSetup>(),[headers,setHeaders]=useState<HeaderSnapshot>(),[pkg,setPkg]=useState<TicketPackage>()
 const [events,setEvents]=useState<PublishedEvent[]>([]),[selected,setSelected]=useState(''),[nextOffset,setNextOffset]=useState<number|null>(null),[consent,setConsent]=useState(false)
 const [cache,setCache]=useState<Awaited<ReturnType<typeof scannerCacheStatus>>>('missing'),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[editing,setEditing]=useState(location.pathname.includes('/prepare'))
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<Result>()
 const mounted=useRef(true),active=useRef<AbortController|null>(null)
 useEffect(()=>{
  mounted.current=true
  void Promise.all([scannerSetupStore.load('active'),loadSnapshot(),scannerEvidenceStore.load('last'),scannerCacheStatus()]).then(([saved,snapshot,last,status])=>{
   if(!mounted.current)return
   if(saved&&saved.review.origin!==location.origin)throw Error('Saved scanner setup belongs to another website. Prepare it here.')
   setSetup(saved);setHeaders(snapshot);setCache(status);setPkg(last?.pkg);setEditing(v=>v||!saved);setLoaded(true)
   if(last)setMessage('Saved ticket evidence loaded. Verify again for a fresh local result.')
  }).catch(e=>{if(mounted.current){setError(e.message);setLoaded(true)}})
  return()=>{mounted.current=false;active.current?.abort(Error('Scanner closed'))}
 },[])
 async function run(action:(signal:AbortSignal)=>Promise<void>){
  if(active.current||!loaded)return
  const controller=new AbortController();active.current=controller;setBusy(true);setError('');setMessage('');setResult(undefined)
  try{await action(controller.signal)}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Scanner operation failed')}
  finally{active.current=null;if(mounted.current)setBusy(false)}
 }
 function loadEvents(more=false){void run(async signal=>{
  if(!navigator.onLine)throw Error('Connect to load published events. Saved scanner setup remains available offline.')
  const response=await scannerJSON(`/api/marketplace/events${more&&nextOffset!==null?`?offset=${nextOffset}`:''}`,signal) as {events:PublishedEvent[];nextOffset:number|null}
  if(!Array.isArray(response.events)||response.events.length>24||response.nextOffset!==null&&(!Number.isSafeInteger(response.nextOffset)||response.nextOffset<0))throw Error('Invalid event catalogue response')
  response.events.forEach(p=>scannerReview(p,location.origin))
  signal.throwIfAborted();if(!mounted.current)return
  setEvents(old=>more?[...old,...response.events.filter(p=>!old.some(e=>e.id===p.id))]:response.events)
  setNextOffset(response.nextOffset);setConsent(false)
  if(!response.events.length&&!more)setMessage('No published events yet. Create and publish an event from the organiser dashboard first.')
 })}
 const chosen=events.find(e=>e.id===selected)
 function prepare(){if(!chosen||!consent)return;void run(async signal=>{
  if(!navigator.onLine)throw Error('Connect before preparing the scanner.')
  const fresh=await scannerJSON(`/api/marketplace/events/${encodeURIComponent(chosen.id)}`,signal) as PublishedEvent
  if(fresh.id!==chosen.id||fresh.venueIdentity!==chosen.venueIdentity||fresh.revision!==chosen.revision)throw Error('This event changed. Load the events again and review its organiser.')
  const current=await scannerSetupStore.load('active')
  if(JSON.stringify(current)!==JSON.stringify(setup))throw Error('Scanner setup changed in another tab. Reload before preparing.')
  const previous=await organiserReviewStore.load(organiserReviewKey({origin:location.origin,eventId:fresh.id}))
  const review=scannerReview(fresh,location.origin,previous)
  const snapshot=await prepareScannerHeaders(signal,text=>{if(mounted.current)setMessage(text)})
  const app=await prepareScannerApp(signal);signal.throwIfAborted()
  await organiserReviewStore.save(review,previous?.revision)
  const saved:ScannerSetup={id:'active',revision:current?current.revision+1:0,review,preparedAt:new Date().toISOString()}
  await scannerSetupStore.save(saved,current?.revision);signal.throwIfAborted()
  const permit=await authoriseOffline(signal);signal.throwIfAborted();if(mounted.current)setAccessExpires(permit.expiresAt)
  if(mounted.current){setSetup(saved);setHeaders(snapshot);setConsent(false);setEditing(false);setPkg(undefined);setCache(app==='waiting'?'waiting':await scannerCacheStatus());setMessage(app==='waiting'?'App update saved. Close scanner tabs and reopen online before disconnecting.':'Event trust, app files and available headers saved. Reload once if instructed below, then test in airplane mode.')}
 })}
 function refresh(){void run(async signal=>{
  if(!setup)throw Error('Prepare an event first.')
  if(!navigator.onLine)throw Error('Connect to refresh scanner preparation. Saved evidence can still be verified locally.')
  const snapshot=await prepareScannerHeaders(signal,text=>{if(mounted.current)setMessage(text)})
  const app=await prepareScannerApp(signal);signal.throwIfAborted()
  const permit=await authoriseOffline(signal);signal.throwIfAborted();if(mounted.current)setAccessExpires(permit.expiresAt)
  if(mounted.current){setHeaders(snapshot);setCache(app==='waiting'?'waiting':await scannerCacheStatus());setMessage('Available headers and app files saved. Verify the ticket again.')}
 })}
 async function importTicket(value:unknown){await run(async signal=>{
  setPkg(undefined)
  const parsed=normalizeScannerTicket(value),old=await scannerEvidenceStore.load('last')
  signal.throwIfAborted();await scannerEvidenceStore.save({id:'last',revision:old?old.revision+1:0,pkg:parsed},old?.revision)
  if(mounted.current){setPkg(parsed);setMessage('Ticket evidence saved on this device. Verify locally to check it.')}
 })}
 function verify(){if(!setup||!pkg)return;void run(async signal=>{
  const check=async()=>{signal.throwIfAborted();if(JSON.stringify(await scannerSetupStore.load('active'))!==JSON.stringify(setup))throw Error('Scanner event trust changed. Reload and verify again.')}
  await check();const snapshot=await loadSnapshot(),checked=await verifyScannerTicket(pkg,setup.review,snapshot)
  await check();if((await loadSnapshot())?.id!==snapshot?.id)throw Error('Saved headers changed during verification. Verify again.')
  if(mounted.current){setHeaders(snapshot);setResult(checked)}
 })}
 return <main className="scanner-page" id="main">
  <nav className="scanner-nav" aria-label="Scanner navigation"><a href="/scanner" aria-current={!location.pathname.includes('/prepare')?'page':undefined}>Scan ticket</a><a href="/scanner/prepare" aria-current={location.pathname.includes('/prepare')?'page':undefined}>Prepare device</a></nav>
  <div className="scanner-heading"><div><span className="scanner-eyebrow">TICKETSV / AT THE ENTRANCE</span><h1>Scan a ticket.</h1><p>Check the evidence here. Keep the verification on this device.</p></div><span className="scanner-tag">BSV testnet · POC</span></div>
  <div className="scanner-layout">
   <aside className="scanner-setup scanner-panel"><div className="scanner-section-title"><DashboardIcon name="prepare"/><h2>{setup?'This scanner':'Prepare this scanner'}</h2></div>
    {setup&&<>{accessExpires&&<p className="scanner-note">Offline scanner access until {new Date(accessExpires).toLocaleString()}. Refresh preparation online before it expires.</p>}<span className="scanner-eyebrow">SELECTED EVENT</span><h3>{setup.review.event.name}</h3><p>{setup.review.event.venue}</p><dl className="scanner-facts"><div><dt>Saved headers</dt><dd>{headers?`Through ${headers.headers.at(-1)!.height.toLocaleString()}`:'Not saved'}</dd></div><div><dt>Offline app</dt><dd>{cache==='ready'?'Saved and active':cache==='reload'?'Reload required':cache==='waiting'?'Update waiting':'Preparation required'}</dd></div></dl>
     <details><summary>Reviewed organiser identity</summary><code>{setup.review.venueIdentity}</code><p>Published revision {setup.review.publicationRevision}. Reviewed {new Date(setup.review.reviewedAt).toLocaleString()}.</p></details>
     <div className="actions"><button className="btn" disabled={busy} onClick={refresh}>Refresh preparation</button><button className="btn" disabled={busy} onClick={()=>{setEditing(v=>!v);setResult(undefined);setConsent(false)}}>Change event</button></div>
     {cache==='reload'&&<a className="btn primary" href="/scanner">Reload scanner</a>}
     {cache==='waiting'&&<p className="scanner-note">Close all scanner tabs, then reopen this page online to activate the saved update.</p>}</>}
    {editing&&<div className="scanner-event-setup"><p>While online, choose the event and review its organiser before saving this scanner. A ticket cannot choose your trusted organiser.</p><button className="btn" disabled={busy||!loaded} onClick={()=>loadEvents()}>Load published events</button>
     {events.length>0&&<><label htmlFor="scanner-event">Event</label><select id="scanner-event" value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setConsent(false);setResult(undefined)}}><option value="">Choose an event</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></>}
     {nextOffset!==null&&<button className="btn" disabled={busy} onClick={()=>loadEvents(true)}>More events</button>}
     {chosen&&<div className="scanner-review"><strong>{chosen.name}</strong><p>{chosen.date} · {chosen.venue}</p><details><summary>Organiser identity from this published event</summary><code>{chosen.venueIdentity}</code></details><p>Confirm this is your intended event and organiser. Publication alone does not prove a real-world identity.</p><label className="scanner-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>I have checked the event and organiser for this scanner.</label><button className="btn primary" aria-label="Save event and prepare offline" disabled={busy||!consent} onClick={prepare}>Save event and prepare offline</button></div>}
    </div>}
   </aside>
   <section className="scanner-panel scanner-check"><div className="scanner-section-title"><DashboardIcon name="scan"/><h2>Check a ticket</h2></div><p>Scan the holder’s ticket QR or load their updated ticket file. All QR frames must arrive before the package can be checked.</p>
    {!setup&&<p className="scanner-note">Prepare an event on this device to enable ticket scanning.</p>}
    <ExchangeImport label="ticket" disabled={busy||!setup||!loaded} onLoad={importTicket}/>
    {pkg&&<div className="scanner-loaded"><span className="scanner-eyebrow">LOADED EVIDENCE</span><strong>Ticket {pkg.issuance.ticketId}</strong><code>{pkg.current.txid}.{pkg.current.index}</code><button className="btn primary" aria-label="Verify locally" disabled={busy||!setup} onClick={verify}>Verify locally</button></div>}
    {result&&<section className={`scanner-result scanner-result-${result.policy}`} aria-live="polite"><span className="scanner-eyebrow">LOCAL RESULT</span><h3>{labels[result.policy]}</h3><ul>{result.verification.checks.map((c,i)=><li key={`${c.name}-${i}`}><strong>{c.name==='recipient'?'Output binding':c.name}: {c.status}</strong><span>{c.reason}</span></li>)}</ul><p>{result.verification.presentedTransferMined?'Presented transfer mining verified against saved headers.':'Presented transfer mining is not verified.'}</p><p>Verification server contacts: 0</p>{result.policy==='incomplete'&&<p>Reconnect and refresh preparation for missing headers, or obtain a ticket file containing complete mining evidence.</p>}{result.policy==='online-check-required'&&<p>The current transfer is unmined. Reconnect to confirm it, then scan its updated mined ticket. Do not treat this result as a door pass.</p>}</section>}
   </section>
  </div>
  {busy&&<p className="scanner-message" role="status">{message||'Working…'} <button className="btn" onClick={()=>active.current?.abort(Error('Cancelled. Saved progress retained.'))}>Cancel</button></p>}
  {!busy&&message&&<p className="scanner-message" role="status">{message}</p>}{error&&<p className="scanner-error" role="alert">{error}</p>}
  <footer className="scanner-limits"><DashboardIcon name="headers"/><div><strong>Evidence checked. Admission is a separate decision.</strong><p>Mined inclusion does not prove current unspentness, presenter key control or that a ticket has not been reused. An unseen double-sale can pass offline authenticity checks. Full difficulty adjustment and best-chain selection are outside this POC.</p></div></footer>
 </main>
}
