import {useEffect,useRef,useState} from 'react'
import {Transaction} from '@bsv/sdk'
import type {ReopeningEvidence} from '../offline/evidence.ts'
import {fromBase64} from '../tickets/codec.ts'
import {loadSnapshot} from '../headers/store.ts'
import {savedImportCandidate,type ImportSource} from '../wallet/import-source.ts'
import {openWalletClient} from '../wallet/connection.ts'
import {loadImport,type ImportRecord} from '../wallet/import-journal.ts'
import {reviewMinedImport,importMinedTicket,reconcileMinedImport,importStore,type MinedImportReview,type ImportDependencies} from '../wallet/mined-import.ts'

function download(record:ImportRecord){const u=URL.createObjectURL(new Blob([JSON.stringify({kind:'counterfoil-wallet-import-diagnostic',record},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='counterfoil-wallet-import-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function inputOutpoints(e:ReopeningEvidence){return Transaction.fromAtomicBEEF(fromBase64(e.pkg.atomicBeefBase64)).inputs.map(i=>`${i.sourceTXID??i.sourceTransaction?.id('hex')}.${i.sourceOutputIndex}`)}
export function WalletImportPanel():React.JSX.Element{
 const [source,setSource]=useState<ImportSource>('download'),[evidence,setEvidence]=useState<ReopeningEvidence>(),[record,setRecord]=useState<ImportRecord>(),[review,setReview]=useState<MinedImportReview>()
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[calls,setCalls]=useState<string[]>([])
 const mounted=useRef(true),active=useRef(false),operation=useRef<AbortController|null>(null),generation=useRef(0)
 async function reload(selected:ImportSource){
  if(active.current)return;active.current=true;setBusy(true);setReview(undefined);setConsent(false);setEvidence(undefined);setRecord(undefined);setError('');setNotice('');setCalls([])
  const token=++generation.current
  try{const next=await savedImportCandidate(selected),journal=next?await loadImport(next.pkg.current.txid):undefined
   if(mounted.current&&token===generation.current){setEvidence(next);setRecord(journal);setNotice(next?'Saved mined evidence loaded. Review it before import.':'No saved mined transfer at this browser origin.')}
  }catch(e){if(mounted.current&&token===generation.current)setNotice(e instanceof Error?e.message:'Could not load mined evidence')}
  finally{if(mounted.current&&token===generation.current){active.current=false;setBusy(false)}}
 }
 useEffect(()=>{mounted.current=true;void reload('download');return()=>{mounted.current=false;generation.current++;active.current=false;operation.current?.abort(new Error('Page closed; any dispatched import may have completed.'))}},[])
 async function run(action:'review'|'import'|'reconcile'){
  if(active.current||!evidence||action==='import'&&(!review||!consent||record))return
  const reviewed=review;active.current=true;setBusy(true);setRunning(true);setError('');setNotice('');setConsent(false);setReview(undefined);setCalls([])
  const c=new AbortController(),token=++generation.current;operation.current=c
  const current=()=>mounted.current&&generation.current===token
  const timer=setTimeout(()=>c.abort(new Error('Wallet operation timed out. A dispatched import may have completed; reconcile without retrying.')),30000)
  const deps:ImportDependencies={...importStore,source:async()=>{const candidate=await savedImportCandidate(source);if(!candidate)throw new Error('Saved mining evidence is missing');return {evidence:candidate,snapshot:await loadSnapshot()}},wallet:s=>openWalletClient('desktop-http',s),log:line=>{if(current()&&!c.signal.aborted)setCalls(xs=>[...xs.slice(-63),line])}}
  try{
   if(action==='review'){
    const r=await reviewMinedImport(evidence,c.signal,deps);if(current()){setReview(r);setNotice('Import review ready.')}
   }else if(action==='import'){
    // The coordinator bounds wallet waits and finalizes uncertainty on cancellation.
    // Wait for that durable save before displaying the result, avoiding a stale
    // pending display racing the unknown-outcome write. Unmount still ignores UI updates.
    const result=await importMinedTicket(reviewed!,c.signal,deps)
    if(current())setRecord(result)
    if(result.attempt.outcome==='accepted'&&!c.signal.aborted){const checked=await reconcileMinedImport(evidence,c.signal,deps);if(current())setRecord(checked)}
   }else{const checked=await reconcileMinedImport(evidence,c.signal,deps);if(current())setRecord(checked)}
  }catch(e){if(current())setError(e instanceof Error?e.message:'Wallet import check failed; reconcile any saved attempt without retrying.')}
  finally{
   clearTimeout(timer)
   if(current()){
    try{setRecord(await loadImport(evidence.pkg.current.txid))}catch{setError('Import journal could not be read. Any dispatched import may have completed; do not retry.')}
    if(current()){active.current=false;setBusy(false);setRunning(false);operation.current=null}
   }
  }
 }
 const observation=record?.observations.at(-1)
 return <section className="wallet-panel" aria-label="Import mined ticket.">
  <p className="eyebrow">EXPLICIT WALLET RECORD CHANGE / EXISTING MINED TRANSFER</p><h2>Import mined ticket.</h2>
  <p>Register the existing buyer ticket in the isolated testnet wallet. This calls internalizeAction and can insert or update transaction and ownership records, including marking consumed wallet inputs spent. It does not create or sign another transfer.</p>
  <p>Stay online for the wallet’s own proof checks. Native wallet network traffic is not monitored. Only an already-mined package is accepted by this experiment; no ARC submission is made here.</p>
  <label>Import evidence source<select disabled={busy} value={source} onChange={e=>{const selected=e.target.value as ImportSource;setSource(selected);void reload(selected)}}><option value="download">Downloaded evidence saved on this device</option><option value="journal">Original experiment diagnostic</option></select></label>
  <button className="btn" disabled={busy} onClick={()=>void reload(source)}>Reload import evidence</button>
  {evidence&&<><p>Exact ticket output: <code className="experiment-id">{evidence.pkg.current.txid}.{evidence.pkg.current.index}</code></p><p>Buyer request: {evidence.buyer.requestId}</p><p>Buyer key: <code className="experiment-id">{evidence.buyer.recipient.publicKey}</code></p></>}
  <button className="btn" disabled={busy||!evidence||!!record} onClick={()=>void run('review')}>Review mined ticket for import</button>
  {review&&<div><p>Importing output {review.evidence.pkg.current.index} into <code>counterfoil-ticket-experiment</code>, with its saved receiving-key instructions.</p><p>Inputs consumed by this already-mined transaction:</p><ul>{inputOutpoints(review.evidence).map(p=><li key={p}><code className="experiment-id">{p}</code></li>)}</ul><p>The transaction bytes and embedded fee remain unchanged. Importing this custom ticket does not import unrelated outputs as wallet payments.</p></div>}
  <label className="experiment-check"><input type="checkbox" checked={consent} disabled={busy||!review||!!record} onChange={e=>setConsent(e.target.checked)}/>I authorize importing this exact mined ticket into the isolated testnet wallet and updating its transaction, ownership and consumed-input records.</label>
  <button className="btn" disabled={busy||!review||!consent||!!record} onClick={()=>void run('import')}>Import reviewed mined ticket</button>
  {record&&<div><h3>Import response: {record.attempt.outcome}</h3><p>Attempt saved at {record.attempt.startedAt}. Further imports of this transaction are blocked at this browser origin.</p><p>{record.attempt.outcome==='accepted'?'The wallet acknowledged the import. Confirm the resulting output below.':'The wallet outcome is uncertain; it may already have changed records. Do not repeat the import.'}</p>{observation&&<><h3>Latest wallet observation: {observation.state}</h3><p>{observation.state==='present'?'The read-only check found a matching ticket output in the experiment basket. That check made no wallet changes; the import response is shown separately above. This does not establish current chain unspentness.':observation.reason}</p><p>Observed at {observation.checkedAt}. This read does not change the saved import response.</p></>}<button className="btn" disabled={busy} onClick={()=>download(record)}>Download wallet import diagnostic</button></div>}
  <button className="btn" disabled={busy||!evidence||!record} onClick={()=>void run('reconcile')}>Reconcile wallet import</button>
  {running&&<button className="btn" onClick={()=>operation.current?.abort(new Error('Wallet operation cancelled. A dispatched import may have completed; reconcile without retrying.'))}>Cancel waiting for wallet</button>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <details><summary>Import wallet calls ({calls.length})</summary><p>Method names only; native wallet traffic is not monitored.</p><ol>{calls.map((line,i)=><li key={i}>{line}</li>)}</ol></details>
  <p>Reconciliation only reads wallet records. It never retries or clears a pending/unknown attempt. Cancelling or closing the page cannot undo an import. Clearing browser storage removes duplicate protection, not wallet changes. This same-wallet experiment does not establish independent buyer custody, current unspentness or admission.</p>
 </section>
}
