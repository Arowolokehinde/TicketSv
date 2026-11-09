import {useEffect,useRef,useState} from 'react'
import {loadExperiment} from '../tickets/experiment-store.ts'
import {loadReopeningEvidence} from '../offline/evidence-store.ts'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {loadSnapshot} from '../headers/store.ts'
import {readSigningEvidenceBytes} from '../verification/signing-spv.ts'
import {fromBase64} from '../tickets/codec.ts'
import {reviewTransfer,minedCandidate,verifyMinedCandidate} from '../settlement/evidence.ts'
import {fetchPolicy,fetchStatus,postTransfer,checkPolicy,ARC_TESTNET} from '../settlement/arc.ts'
import {loadSettlement,saveSettlement,ensureSettlement} from '../settlement/store.ts'
import {submitReviewedTransfer,reconcileSettlement,defaultSettlementDependencies} from '../settlement/coordinator.ts'
import type {ArcObservation,ArcPolicy,SettlementRecord,TransferReview} from '../settlement/types.ts'
import type {Verification} from '../tickets/types.ts'
type Source='download'|'journal'
type Action='review'|'policy'|'status'|'submit'|'proof'
type Contact={at:string;purpose:string;result:'started'|'returned'|'failed'}
async function sourceEvidence(source:Source):Promise<ReopeningEvidence|undefined>{
 if(source==='download')return loadReopeningEvidence()
 const r=await loadExperiment();if(!r)return undefined
 if(r.attempt.phase!=='transfer'||r.attempt.status!=='complete'||!r.pkg||!r.buyer)throw new Error('Original diagnostic has no completed transfer. Use downloaded evidence if available.')
 return readReopeningEvidence({kind:'counterfoil-reopening-evidence',version:1,trusted:r.trusted,pkg:r.pkg,buyer:r.buyer})
}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function SettlementPanel():React.JSX.Element{
 const [source,setSource]=useState<Source>('download'),[evidence,setEvidence]=useState<ReopeningEvidence>(),[record,setRecord]=useState<SettlementRecord>()
 const [review,setReview]=useState<TransferReview>(),[policy,setPolicy]=useState<ArcPolicy>(),[status,setStatus]=useState<ArcObservation>(),[candidate,setCandidate]=useState<ReopeningEvidence>(),[verdict,setVerdict]=useState<Verification>()
 const [consent,setConsent]=useState(false),[retry,setRetry]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[contacts,setContacts]=useState<Contact[]>([])
 const mounted=useRef(true),operation=useRef<AbortController|null>(null),loading=useRef(0),active=useRef(false)
 function invalidate(){setReview(undefined);setPolicy(undefined);setConsent(false);setRetry(false);setStatus(undefined);setCandidate(undefined);setVerdict(undefined)}
 async function load(source:Source,initial=false){
  const token=++loading.current;setBusy(true);active.current=true
  try{
   let selected=source,found=await sourceEvidence(source)
   if(!found&&initial){selected='journal';found=await sourceEvidence(selected)}
   const saved=found?await loadSettlement(found.pkg.current.txid):undefined
   if(!mounted.current||token!==loading.current)return
   setSource(selected);setEvidence(found);setRecord(saved);invalidate();setStatus(saved?.lastStatus);setError('');setNotice(found?'Saved evidence loaded. Review it before submission.':'No saved transfer at this browser origin. Save evidence in the reopening experiment first.')
  }catch(e){if(mounted.current&&token===loading.current){setError(e instanceof Error?e.message:'Could not load settlement evidence');setEvidence(undefined);setRecord(undefined);invalidate()}}
  finally{if(mounted.current&&token===loading.current){setBusy(false);active.current=false}}
 }
 useEffect(()=>{mounted.current=true;void load('download',true);return()=>{mounted.current=false;operation.current?.abort();loading.current++}},[])
 async function contact<T>(purpose:string,fn:()=>Promise<T>):Promise<T>{
  const at=new Date().toISOString();if(mounted.current)setContacts(xs=>[...xs.slice(-63),{at,purpose,result:'started'}])
  try{const value=await fn();if(mounted.current)setContacts(xs=>[...xs.slice(-63),{at:new Date().toISOString(),purpose,result:'returned'}]);return value}
  catch(e){if(mounted.current)setContacts(xs=>[...xs.slice(-63),{at:new Date().toISOString(),purpose,result:'failed'}]);throw e}
 }
 const deps={...defaultSettlementDependencies,policy:(s:AbortSignal)=>contact('GET /policy',()=>fetchPolicy(s)),status:(id:string,s:AbortSignal)=>contact('GET /tx/{txid}',()=>fetchStatus(id,s)),post:(hex:string,id:string,s:AbortSignal)=>contact('POST /tx',()=>postTransfer(hex,id,s))}
 async function freshSource(){const fresh=await sourceEvidence(source);if(!fresh||JSON.stringify(fresh)!==JSON.stringify(evidence))throw new Error('Saved evidence changed. Reload the selected source and review again.');return fresh}
 async function verifyProof(fresh:ReopeningEvidence,observed:ArcObservation|undefined){
  if(!observed)throw new Error('Check transfer status first')
  const saved=await loadSettlement(fresh.pkg.current.txid)
  if(saved&&JSON.stringify(saved.lastStatus)!==JSON.stringify(observed))throw new Error('Saved status changed in another tab. Check transfer status again.')
  const next=minedCandidate(fresh,observed),result=await verifyMinedCandidate(fresh,observed,await loadSnapshot())
  if(saved){const updated={...saved,revision:saved.revision+1,candidate:next};await saveSettlement(updated,saved.revision);if(mounted.current)setRecord(updated)}
  return {next,result}
 }
 async function run(action:Action){
  if(active.current||!evidence)return
  active.current=true;setBusy(true);setError('');setNotice('');const c=new AbortController();operation.current=c
  setVerdict(undefined);setCandidate(undefined)
  if(action==='submit'){setConsent(false);setRetry(false)}
  try{
   const fresh=await freshSource();c.signal.throwIfAborted()
   if(action==='review'){
    const result=await reviewTransfer(fresh,await loadSnapshot());c.signal.throwIfAborted();setReview(result);setPolicy(undefined);setConsent(false);setRetry(false);setNotice('Transfer reviewed locally. Check provider policy, then review the broadcast acknowledgement.')
   }else if(action==='policy'){
    if(!review)throw new Error('Review the saved transfer first')
    const p=await deps.policy(c.signal);c.signal.throwIfAborted();checkPolicy(review,p);setPolicy(p);setNotice('Provider policy checked. This does not guarantee acceptance or mining.')
   }else if(action==='status'){
    const saved=await ensureSettlement(fresh)
    const next=await reconcileSettlement(saved,c.signal,deps);setRecord(next);setStatus(next.lastStatus);setNotice(next.lastStatus?'Provider status saved; mining still requires local proof verification.':'Provider reports transaction not found. This does not prove it was never broadcast.')
    setConsent(false);setRetry(false)
   }else if(action==='submit'){
    if(!review||!policy||!consent)throw new Error('Review, policy and explicit broadcast acknowledgement are required')
    if(status&&status.txStatus!=='UNKNOWN')throw new Error('A provider status is already known; check its evidence instead of submitting again')
    const next=await submitReviewedTransfer(review,record?.revision,c.signal,retry,{...deps,review:async r=>{const fresh=await freshSource();return reviewTransfer(fresh,await loadSnapshot()).then(result=>{if(JSON.stringify(fresh)!==JSON.stringify(r.evidence))throw new Error('Evidence changed');return result})}})
    if(mounted.current){setRecord(next);setStatus(next.lastStatus);setNotice(next.attempts.at(-1)!.outcome==='unknown'?'Submission outcome unknown. Check transfer status; no automatic retry will run.':'Provider response saved. This is not a verified mining result.')}
   }else{
    const {next,result}=await verifyProof(fresh,status);c.signal.throwIfAborted();setCandidate(next);setVerdict(result);setNotice(result.verdict==='verified'&&result.presentedTransferMined?'Current transfer inclusion verified against local headers.':'Mining evidence is not verified. Sync missing headers or inspect the failed checks.')
   }
  }catch(e){if(mounted.current){setError(e instanceof Error?e.message:'Settlement check failed');if(action==='review'||action==='submit'){setReview(undefined);setPolicy(undefined);setConsent(false);setRetry(false)}if(action==='proof'){setCandidate(undefined);setVerdict(undefined)}}}
  finally{
   if(action==='submit'&&mounted.current){try{setRecord(await loadSettlement(evidence.pkg.current.txid))}catch{setError('Submission outcome may be unknown; settlement storage could not be read. Do not repeat blindly.')}}
   if(mounted.current){setBusy(false);active.current=false}operation.current=null
  }
 }
 async function exportVerified(){
  if(active.current||!verdict||verdict.verdict!=='verified'||!verdict.presentedTransferMined)return
  active.current=true;setBusy(true);setError('')
  try{const {next,result}=await verifyProof(await freshSource(),status);setCandidate(next);setVerdict(result);if(result.verdict!=='verified'||!result.presentedTransferMined)throw new Error('Mining verification is no longer complete');download('counterfoil-mined-ticket-package.json',next.pkg)}catch(e){setVerdict(undefined);setCandidate(undefined);setError(e instanceof Error?e.message:'Export verification failed')}finally{if(mounted.current){active.current=false;setBusy(false)}}
 }
 function exportSpv(){
  if(!evidence||!status)return
  try{const next=minedCandidate(evidence,status),parsed=readSigningEvidenceBytes(next.pkg.current.txid,fromBase64(next.pkg.atomicBeefBase64));download('counterfoil-candidate-mining-spv.json',{kind:'counterfoil-signing-result',network:'testnet',final:{txid:parsed.txid,atomicBeefBase64:next.pkg.atomicBeefBase64},note:'Candidate mining evidence; not locally verified. Sync headers and verify.'})}catch(e){setError(e instanceof Error?e.message:'Proof unavailable')}
 }
 const retryReady=!record?.attempts.length||record.attempts.length<3&&record.reconciledAttemptId===record.attempts.at(-1)?.id&&retry&&(!record.lastStatus||record.lastStatus.txStatus==='UNKNOWN')
 const canSubmit=!!review&&!!policy&&consent&&retryReady&&!record?.retryBlockedBy&&(!status||status.txStatus==='UNKNOWN')&&!busy
 const mined=status?.txStatus==='MINED'||status?.txStatus==='IMMUTABLE'
 return <section className="wallet-panel settlement-panel" aria-label="Online transfer submission.">
  <p className="eyebrow">ONLINE SETTLEMENT / EXISTING SIGNED TRANSFER</p><h2>Online transfer submission.</h2>
  <p>Publish the saved testnet transfer, check its status, and verify a mining proof against local headers. This experiment makes no wallet requests.</p>
  <p>Provider: <code>{ARC_TESTNET}</code>. Direct browser requests; no automatic submission or retry.</p>
  <label>Settlement evidence source<select value={source} disabled={busy} onChange={e=>{invalidate();void load(e.target.value as Source)}}><option value="download">Downloaded evidence saved on this device</option><option value="journal">Original experiment diagnostic</option></select></label>
  <p><a href="/dev/reopening">Save downloaded ticket evidence in the reopening experiment</a></p>
  {evidence&&<><p>Transfer: <code className="experiment-id">{evidence.pkg.current.txid}.{evidence.pkg.current.index}</code></p><p>Recipient request: {evidence.buyer.requestId}</p><p>Recipient key: <code className="experiment-id">{evidence.buyer.recipient.publicKey}</code></p></>}
  <button className="btn" disabled={busy||!evidence} onClick={()=>void run('review')}>Review saved transfer</button>
  {review&&<div><p>Embedded fee: {review.fee} testnet satoshis</p><p>Transaction size: {review.rawBytes} bytes</p><p>Inputs spent if accepted:</p><ul>{review.inputs.map(i=><li key={`${i.txid}.${i.index}`}><code className="experiment-id">{i.txid}.{i.index}</code>: {i.satoshis} satoshis</li>)}</ul><p>Outputs:</p><ul>{review.outputs.map(o=><li key={o.index}>Output {o.index}: {o.satoshis} satoshis{o.index===evidence?.pkg.current.index?' — buyer ticket':''}</li>)}</ul></div>}
  <button className="btn" disabled={busy||!review} onClick={()=>void run('policy')}>Check provider policy</button>
  {policy&&<p>Advertised fee: {policy.feeSatoshis} satoshis per {policy.feeBytes} bytes. Existing fee meets this policy.</p>}
  <button className="btn" disabled={busy||!evidence} onClick={()=>void run('status')}>Check transfer status</button>
  {status&&<p>Provider status: {status.txStatus}</p>}
  {status&&<p>Observed at: {status.observedAt}</p>}
  {!!record?.attempts.length&&<><p>Saved submission attempts: {record.attempts.length}</p><p>Latest attempt: {record.attempts.at(-1)!.outcome}. A pending or unknown response may already have reached the provider.</p><label className="experiment-check"><input type="checkbox" checked={retry} disabled={busy||!!record.retryBlockedBy} onChange={e=>setRetry(e.target.checked)}/>I acknowledge the uncertain previous outcome and authorize retrying only these identical signed bytes after checking status.</label></>}
  {record?.retryBlockedBy&&<p>Earlier provider status {record.retryBlockedBy} blocks submission. A later unknown or not-found result does not clear it; manual review is required.</p>}
  {!!record?.statusChecks.length&&<details><summary>Saved status checks ({record.statusChecks.length} most recent)</summary><ol>{record.statusChecks.map((c,i)=><li key={i}>{c.checkedAt} — {c.observation?.txStatus??'HTTP 404: not found'}</li>)}</ol></details>}
  <label className="experiment-check"><input type="checkbox" checked={consent} disabled={busy||!review||!policy} onChange={e=>setConsent(e.target.checked)}/>I authorize publishing this exact signed transfer to testnet, spending the displayed inputs and embedded fee.</label>
  <button className="btn" disabled={!canSubmit} onClick={()=>void run('submit')}>Submit reviewed transfer to testnet</button>
  <p>Submission publishes the existing signed transaction. It does not ask the wallet to sign again or change its fee. Cancelling a request cannot undo a broadcast.</p>
  <button className="btn" disabled={busy||!evidence||!mined} onClick={()=>void run('proof')}>Verify mining proof locally</button>
  <button className="btn" disabled={busy||!status?.merklePath||!mined} onClick={exportSpv}>Download candidate evidence for header sync</button>
  <p>If headers are missing, load the candidate SPV file in Local SPV above and sync while online, then verify here. No headers are fetched during local verification.</p>
  {verdict&&<div><h3>Mining proof verification: {verdict.verdict}</h3><ul>{verdict.checks.map(c=><li key={c.name}>{c.name}: {c.status} — {c.reason}</li>)}</ul><p>Local verification server contacts: 0.</p></div>}
  <button className="btn" disabled={busy||!candidate||verdict?.verdict!=='verified'||!verdict.presentedTransferMined} onClick={()=>void exportVerified()}>Download updated ticket package</button>
  <button className="btn" disabled={busy||!evidence} onClick={()=>download('counterfoil-settlement-observation.json',{kind:'counterfoil-settlement-observation',version:1,observedAt:new Date().toISOString(),provider:ARC_TESTNET,txid:evidence?.pkg.current.txid,attempts:record?.attempts,statusChecks:record?.statusChecks,retryBlockedBy:record?.retryBlockedBy,status,verification:verdict,contacts,limits:'Provider status is not chain truth. Local verification is checkpoint-relative; full DAA, best-chain selection, current unspentness, independent custody and admission are not established. Wallet import not attempted.'})}>Download settlement observation</button>
  {busy&&operation.current&&<button className="btn" onClick={()=>operation.current?.abort(new Error('Cancelled; a sent submission may still complete'))}>Cancel settlement request</button>}
  <p role="status">{notice}</p>{error&&<p role="alert">{error}</p>}
  <details><summary>Settlement network log ({contacts.filter(c=>c.result==='started').length} requests in retained log)</summary><ol>{contacts.map((c,i)=><li key={i}>{c.at} — {c.purpose}: {c.result}</li>)}</ol></details>
  <p>Evidence remains diagnostic. Mining inclusion does not prove current unspentness or admission eligibility. Full difficulty adjustment, best-chain selection and wallet import remain separate.</p>
 </section>
}
