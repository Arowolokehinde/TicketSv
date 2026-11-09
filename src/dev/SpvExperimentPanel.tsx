import {useEffect,useRef,useState} from 'react'
import {CHECKPOINT,HEADER_TRUST} from '../headers/checkpoint.ts'
import {loadSnapshot,loadSnapshotForRecheck,saveSnapshot,type SnapshotExpectation} from '../headers/store.ts'
import {pacedHeaderFetcher,syncHeaders} from '../headers/sync.ts'
import type {HeaderContact,HeaderSyncProgress} from '../headers/sync.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {MAX_EVIDENCE_FILE_BYTES,readSigningEvidence,verifySigningEvidence} from '../verification/signing-spv.ts'
import type {SigningEvidence,SpvReport} from '../verification/signing-spv.ts'

export function SpvExperimentPanel():React.JSX.Element {
 const [snapshot,setSnapshot]=useState<HeaderSnapshot>()
 const [evidence,setEvidence]=useState<SigningEvidence>()
 const [report,setReport]=useState<SpvReport>()
 const [error,setError]=useState(''),[message,setMessage]=useState('')
 const [busy,setBusy]=useState(true),[syncing,setSyncing]=useState(false)
 const [online,setOnline]=useState(navigator.onLine)
 const [contacts,setContacts]=useState<HeaderContact[]>([])
 const [contactCount,setContactCount]=useState(0)
 const [progress,setProgress]=useState<HeaderSyncProgress>()
 const controller=useRef<AbortController|undefined>(undefined)
 const mounted=useRef(false)
 useEffect(()=>{
  mounted.current=true;let active=true
  void loadSnapshot().then(s=>{if(active)setSnapshot(s)}).catch(()=>{if(active)setError('Stored headers failed validation or could not be read — use Recheck all headers while online')}).finally(()=>{if(active)setBusy(false)})
  const connection=()=>setOnline(navigator.onLine)
  window.addEventListener('online',connection);window.addEventListener('offline',connection)
  return()=>{active=false;mounted.current=false;controller.current?.abort();window.removeEventListener('online',connection);window.removeEventListener('offline',connection)}
 },[])
 const reset=()=>{setReport(undefined);setError('');setMessage('')}
 const explain=(e:unknown)=>setError(e instanceof Error?e.message.slice(0,400):'Experiment failed')
 async function load(file:File|undefined){
  if(!file)return;reset();setEvidence(undefined);setBusy(true)
  try{if(file.size>MAX_EVIDENCE_FILE_BYTES)throw new Error('Signing result exceeds 4 MiB limit');const text=await file.text();if(mounted.current)setEvidence(readSigningEvidence(text))}
  catch(e){if(mounted.current)explain(e)}finally{if(mounted.current)setBusy(false)}
 }
 async function verify(){
  if(!evidence)return;reset();setBusy(true)
  try{const r=await verifySigningEvidence(evidence,snapshot);if(mounted.current)setReport(r)}
  catch(e){if(mounted.current)explain(e)}finally{if(mounted.current)setBusy(false)}
 }
 async function sync(fullRefresh=false){
  if(!evidence||controller.current)return;reset();setBusy(true);setSyncing(true);setProgress(undefined)
  const c=new AbortController();controller.current=c
  try{
   if(!navigator.onLine)throw new Error('Reconnect to sync headers, then verify locally')
   if(evidence.anchors.some(h=>h<CHECKPOINT.height))throw new Error('An anchor predates this experiment’s checkpoint; rebootstrap must be reviewed')
   // Read the latest disk state before resuming; another tab may have advanced it.
   const recovery=fullRefresh?await loadSnapshotForRecheck():undefined
   let saved=fullRefresh?recovery!.snapshot:await loadSnapshot()
   let expected:SnapshotExpectation=recovery?.expected??{id:saved?.id}
   c.signal.throwIfAborted()
   const reused=fullRefresh?0:saved?.headers.length??0
   setProgress({completed:reused,reused,total:Math.max(evidence.requiredHeight,saved?.headers.at(-1)?.height??CHECKPOINT.height)-CHECKPOINT.height+1,height:saved?.headers.at(-1)?.height??CHECKPOINT.height})
   const persist=async(next:HeaderSnapshot)=>{
    c.signal.throwIfAborted();await saveSnapshot(next,c.signal,expected);saved=next;expected={id:next.id}
    if(mounted.current)setSnapshot(next)
   }
   const {snapshot:next,affectedHeights}=await syncHeaders(evidence.requiredHeight,saved,pacedHeaderFetcher(entry=>{if(mounted.current){setContactCount(n=>n+1);setContacts(prev=>[...prev.slice(-511),entry])}}),c.signal,p=>{if(mounted.current&&!c.signal.aborted)setProgress(p)},{fullRefresh,onCheckpoint:persist})
   c.signal.throwIfAborted();await persist(next)
   if(mounted.current){setSnapshot(next);setMessage(affectedHeights.length?'Header snapshot saved; changed headers require fresh verification.':'Header snapshot saved.')}
  }catch(e){
   c.abort();if(mounted.current)explain(e)
   // A completed checkpoint or a competing tab's save may be newer than UI state.
   try{const latest=await loadSnapshot();if(mounted.current)setSnapshot(latest)}catch{/* preserve the original sync error */}
  }finally{if(mounted.current){setBusy(false);setSyncing(false)}controller.current=undefined}
 }
 return <section className="wallet-panel spv-panel" aria-labelledby="spv-heading">
  <p className="eyebrow">LOCAL EVIDENCE / NO WALLET ACTIONS</p>
  <h2 id="spv-heading">Local SPV experiment.</h2>
  <p>Load your signing-result JSON, sync the required headers while online, then disconnect and verify locally. This checks transaction evidence; venue identity, ticket continuity and buyer ownership are separate checks.</p>
  <div className="development-status" aria-label="SPV experiment status">
   <span>{online?'Browser reports online':'Browser reports offline'}</span>
   <span>Header source requests this session: {contactCount}</span>
   <span>{evidence?`Proof size: ${evidence.atomicBeef.length} bytes`:'No signing result loaded'}</span>
  </div>
  <p>{snapshot?`Stored headers: ${snapshot.headers[0].height}–${snapshot.headers.at(-1)!.height}. Synced ${snapshot.syncedAt}.`:'No local header snapshot.'}</p>
  {snapshot&&<p>Snapshot: <code className="spv-id">{snapshot.id}</code></p>}
  <label>Load signing result for SPV <input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void load(file)}} /></label>
  {evidence&&<p>Required anchor heights: {evidence.anchors.join(', ')}. Subject: <code className="spv-id">{evidence.txid}</code></p>}
  <div className="spv-actions">
   <button className="btn" type="button" disabled={busy||!evidence||!online} onClick={()=>void sync()}>Sync required headers</button>
   <button className="btn" type="button" disabled={busy||!evidence||!online} onClick={()=>void sync(true)}>Recheck all headers</button>
   <button className="btn" type="button" disabled={busy||!evidence} onClick={()=>void verify()}>Verify locally</button>
   {syncing&&<button className="btn" type="button" onClick={()=>controller.current?.abort(new Error('Header sync cancelled; validated saved progress retained'))}>Cancel header sync</button>}
  </div>
  {busy&&<p role="status">{syncing?`${progress?.completed??0} / ${progress?.total??0} headers cross-checked. Reusing ${progress?.reused??0} stored headers; saving validated progress as it arrives…`:'Reading or checking local evidence…'}</p>}
  {message&&<p role="status">{message}</p>}
  {error&&<p className="wallet-error" role="alert">{error}</p>}
  {report&&<div className="spv-result" role="status">
   <p>Transaction evidence verified against local headers.</p>
   <ul><li>Atomic BEEF dependencies and SDK verification passed; unmined dependency scripts were checked where applicable.</li><li>Merkle anchors match stored headers at {report.anchors.join(', ')}.</li><li>{report.subjectMined?'The subject has a mining proof in this snapshot.':'The loaded package has no mining proof for the latest transfer — its current mining status is unknown.'}</li></ul>
   <p>Verification server contacts: 0</p>
   <p>Venue authenticity, buyer ownership, current unspentness and admission eligibility are not established by this experiment.</p>
  </div>}
  <details><summary>Header network log ({contacts.length}{contactCount>contacts.length?` most recent of ${contactCount}`:''})</summary><p>Only this panel’s header requests are logged, including retry attempts. Verification has no network adapter; native wallet traffic is not monitored.</p><ol>{contacts.map((c,i)=><li key={i}>{c.at} — {c.provider}, height {c.height}, attempt {c.attempt??1}: {c.status}{c.failure?` (${c.failure}${c.httpStatus?` ${c.httpStatus}`:''})`:''}</li>)}</ol></details>
  <p className="boundary">{HEADER_TRUST} Checkpoint {CHECKPOINT.height}; preparation resumes from saved progress in bounded operations. A saved prefix can be shorter than the ticket requires: missing anchors remain incomplete. Verify again against the latest saved snapshot.</p>
  <p className="boundary">Headers persist in this browser’s IndexedDB. The loaded package and verdict stay in this tab. Keep it open for the offline check; offline app reopening is not implemented.</p>
  <p className="boundary">Normal sync reuses locally validated history, rechecks its last header with both sources and downloads only missing heights. Validated progress is saved after the first new header and every 32 new headers; cancellation or failure retains those saves. Reopening resumes from the last saved height, with up to 31 downloaded headers to repeat. Each sync operation has a two-minute budget; a cold direct-provider download can require multiple resumptions. Temporary requests get up to three attempts with backoff.</p>
  <p className="boundary">Recheck all headers downloads the entire range and replaces the saved snapshot only when complete. Use it if the saved boundary has changed or a full refresh is needed. A boundary check is not full difficulty adjustment or best-chain selection.</p>
 </section>
}
