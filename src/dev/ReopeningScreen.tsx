import {useEffect,useRef,useState} from 'react'
import {loadExperiment,type ExperimentRecord} from '../tickets/experiment-store.ts'
import {loadSnapshot} from '../headers/store.ts'
import {completedTransfer,verifySavedTransfer,checkSavedKey,checkEvidenceKey,type KeyAccessEvidence} from '../offline/reopening.ts'
import {readReopeningEvidence,verifyReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {loadReopeningEvidence,saveReopeningEvidence} from '../offline/evidence-store.ts'
import {MAX_PACKAGE_BYTES,readTicketPackage,readReceiveRequest} from '../tickets/codec.ts'
import {prepareOfflineApp} from '../offline/cache.ts'
import {openWalletClient} from '../wallet/connection.ts'
import type {Verification,TicketPackage,ReceiveRequest} from '../tickets/types.ts'
import {summarizeError} from '../wallet/diagnostics.ts'

export function ReopeningScreen():React.JSX.Element{
 const [record,setRecord]=useState<ExperimentRecord>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
 const [imported,setImported]=useState<ReopeningEvidence>(),[source,setSource]=useState<'journal'|'files'>('journal')
 const [draftPackage,setDraftPackage]=useState<TicketPackage>(),[draftBuyer,setDraftBuyer]=useState<ReceiveRequest>()
 const [trusted,setTrusted]=useState('02828e341092c4a01d8b069b02fba9afc66092f4da2ddb14f4e101976675541d58')
 const [phase,setPhase]=useState<'cache'|'verify'|'key'>()
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[verdict,setVerdict]=useState<Verification>()
 const [consent,setConsent]=useState(false),[proof,setProof]=useState<KeyAccessEvidence>(),[calls,setCalls]=useState<string[]>([])
 const [controlled,setControlled]=useState(false),[online,setOnline]=useState(navigator.onLine)
 const active=useRef<AbortController|undefined>(undefined),mounted=useRef(false),running=useRef(false)
 useEffect(()=>{
  mounted.current=true;let cancelled=false
  const control=()=>setControlled(!!navigator.serviceWorker?.controller)
  const connectivity=()=>setOnline(navigator.onLine)
  control();navigator.serviceWorker?.addEventListener('controllerchange',control)
  window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity)
  void Promise.allSettled([loadExperiment(),loadReopeningEvidence()]).then(([journal,evidence])=>{
   if(cancelled)return
   const problems:string[]=[]
   if(journal.status==='fulfilled')setRecord(journal.value)
   else problems.push(`Saved diagnostic unavailable: ${summarizeError(journal.reason).message}`)
   if(evidence.status==='fulfilled'){
    setImported(evidence.value)
    if(evidence.value){setSource('files');setTrusted(evidence.value.trusted)}
   }else problems.push(`Saved file evidence unavailable: ${summarizeError(evidence.reason).message}`)
   setError(problems.join(' '));setLoaded(true)
  })
  return()=>{cancelled=true;mounted.current=false;active.current?.abort(new Error('Page closed'));navigator.serviceWorker?.removeEventListener('controllerchange',control);window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity)}
 },[])
 const journalComplete=record?.attempt.phase==='transfer'&&record.attempt.status==='complete'
 const complete=source==='files'?!!imported:journalComplete
 const selected=source==='files'?imported:journalComplete?record:undefined
 function invalidate(){setVerdict(undefined);setProof(undefined);setConsent(false);setNotice('');setError('')}
 async function loadFile(kind:'package'|'buyer',file:File|undefined){
  if(!file||running.current)return
  running.current=true;setBusy(true);invalidate()
  if(kind==='package')setDraftPackage(undefined);else setDraftBuyer(undefined)
  try{
   if(file.size>MAX_PACKAGE_BYTES)throw new Error('Evidence file exceeds 4 MiB limit')
   const text=await file.text()
   if(!mounted.current)return
   if(kind==='package')setDraftPackage(readTicketPackage(text));else setDraftBuyer(readReceiveRequest(text))
  }catch(e){if(mounted.current)setError(summarizeError(e).message??'Invalid evidence file')}
  finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 async function saveFiles(){
  if(running.current||!draftPackage||!draftBuyer)return
  running.current=true;setBusy(true);invalidate()
  try{
   const next=readReopeningEvidence({kind:'counterfoil-reopening-evidence',version:1,trusted:trusted.trim(),pkg:draftPackage,buyer:draftBuyer})
   const result=await verifyReopeningEvidence(next,await loadSnapshot())
   if(!mounted.current)return
   if(result.verdict==='rejected')throw new Error(`Loaded evidence rejected: ${result.checks.filter(c=>c.status==='fail').map(c=>`${c.name}: ${c.reason}`).join('; ')}. Previous saved evidence retained.`)
   const saved=await saveReopeningEvidence(next,imported)
   if(!mounted.current)return
   setImported(saved);setSource('files');setVerdict(result)
   setNotice(`Evidence saved locally. ${result.verdict==='verified'?'All local checks passed.':'Verification incomplete — required headers must be available before this evidence can be verified.'} Wallet diagnostic unchanged.`)
  }catch(e){if(mounted.current)setError(summarizeError(e).message??'Could not save evidence')}
  finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 async function run(kind:'cache'|'verify'|'key'){
  if(running.current||kind==='key'&&(!consent||verdict?.verdict!=='verified'))return
  running.current=true;setPhase(kind);setBusy(true);setError('');setNotice('')
  const c=new AbortController();active.current=c
  let timer:ReturnType<typeof setTimeout>|undefined
  try{
   if(kind==='cache'){
    const message=await prepareOfflineApp();if(mounted.current)setNotice(message)
   }else{
    setProof(undefined);setVerdict(undefined)
    const fresh=source==='files'?readReopeningEvidence(await loadReopeningEvidence()):completedTransfer(await loadExperiment()),snapshot=await loadSnapshot()
    if(!mounted.current)return
    if('kind' in fresh)setImported(fresh);else setRecord(fresh)
    const report=source==='files'?await verifyReopeningEvidence(fresh,snapshot):await verifySavedTransfer(fresh,snapshot)
    c.signal.throwIfAborted();setVerdict(report)
    if(kind==='key'){
     if(JSON.stringify(selected)!==JSON.stringify(fresh))throw new Error('Saved evidence changed. Verify it again before authorizing a key check.')
     if(report.verdict!=='verified')throw new Error('Verify the saved transfer against local headers before checking wallet key access.')
     timer=setTimeout(()=>c.abort(new Error('Wallet key check timed out. Review any wallet prompt; no transaction was requested.')),30000)
     const check=source==='files'?checkEvidenceKey:checkSavedKey
     const result=await check(()=>openWalletClient('desktop-http',c.signal),fresh,c.signal,line=>{if(mounted.current)setCalls(p=>[...p.slice(-79),line])})
     c.signal.throwIfAborted();if(mounted.current)setProof(result)
    }
   }
  }catch(e){if(mounted.current)setError(summarizeError(e).message??'Reopening check failed')}
  finally{clearTimeout(timer);active.current=undefined;running.current=false;if(mounted.current){setBusy(false);setPhase(undefined);setConsent(false)}}
 }
 function download(){
  if(!selected||!verdict)return
  const result={kind:'counterfoil-reopening-observation',version:1,observedAt:new Date().toISOString(),browserReportsOnline:online,workerControlsPage:controlled,source,txid:selected.pkg?.current.txid,trustedVenue:selected.trusted,receivingRequest:selected.buyer?.requestId,recordRevision:source==='journal'?record?.revision:undefined,verification:verdict,verificationServerContacts:0,keyAccess:proof,limits:'Native wallet networking and physical restart are operator observations. This is not ticket acceptance, broadcast, current unspentness or admission.'}
  downloadJSON(result,'counterfoil-reopening-observation.json')
 }
 function downloadJSON(result:unknown,name:string){
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a')
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 return <main className="development-page">
  <p className="eyebrow">OFFLINE REOPENING / SAVED DIAGNOSTICS</p>
  <h1>Offline reopening experiment.</h1>
  <p>Reopen the app, verify the saved transfer, then separately check its receiving key. This same-wallet experiment does not create, import or broadcast a transaction.</p>
  <p>Browser reports {online?'online':'offline'}. {controlled?'This page is controlled by the offline worker.':'This page is not controlled by the offline worker yet.'}</p>
  <section className="wallet-panel" aria-label="Offline app preparation">
   <h2>1. Save the app while online</h2>
   <p>Use the production preview on the exact origin where your diagnostic and headers are saved. Cache preparation applies only to this reopening page. Close all reopening tabs to activate a waiting update; updates never take over an open tab.</p>
   {!import.meta.env.PROD&&<p>The development server cannot be prepared for offline reopening. Follow the production-preview instructions in docs/offline-reopening-experiment.md.</p>}
   <button className="btn" disabled={busy||!import.meta.env.PROD} onClick={()=>void run('cache')}>Prepare app for offline reopening</button>
   <p>After preparation, reload once online. Verify the saved transfer, disconnect external internet, close this tab, and reopen this same address. Keep the local wallet running for the first test. Browser storage may be cleared or evicted; keep your downloaded evidence.</p>
  </section>
  <section className="wallet-panel" aria-label="Saved transfer verification">
   <h2>2. Load evidence and verify after reopening</h2>
   <p>If the original diagnostic is missing, load your downloaded ticket package and the buyer request you saved independently before handoff. This saves a separate evidence bundle; it does not import wallet records, recover an action or accept a ticket.</p>
   <label>Trusted venue identity for loaded files <input value={trusted} disabled={busy||!loaded} onChange={e=>{setTrusted(e.target.value);invalidate()}} /></label>
   <p>The default is the identity previously observed in the isolated test wallet. Confirm trust independently. Loading a package never changes this setting.</p>
   <label>Load downloaded ticket package <input type="file" accept=".json,application/json" disabled={busy||!loaded} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void loadFile('package',file)}} /></label>
   <label>Load independently saved buyer request <input type="file" accept=".json,application/json" disabled={busy||!loaded} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void loadFile('buyer',file)}} /></label>
   <p>{draftPackage?`Loaded ticket: ${draftPackage.current.txid}.${draftPackage.current.index}`:'No new ticket file loaded.'} {draftBuyer?`Loaded buyer request: ${draftBuyer.requestId}`:'No new buyer request loaded.'}</p>
   <button className="btn" disabled={busy||!draftPackage||!draftBuyer} onClick={()=>void saveFiles()}>Check and save loaded evidence</button>
   <p>Only evidence is saved. Missing headers leave verification incomplete; failed signature, history or recipient checks prevent replacement. A new verdict is required after reopening.</p>
   <label>Saved evidence source <select value={source} disabled={busy||!loaded} onChange={e=>{setSource(e.target.value as 'journal'|'files');invalidate()}}><option value="journal">Original experiment diagnostic</option><option value="files" disabled={!imported}>Downloaded evidence saved on this device</option></select></label>
   {!loaded?<p>{error?'Saved diagnostic could not be loaded.':'Reading saved diagnostic…'}</p>:!complete?<p>No completed transfer saved at this browser origin.</p>:<>
    <p>Saved transfer: <code>{selected?.pkg?.current.txid}.{selected?.pkg?.current.index}</code></p>
    <p>Trusted venue from your saved {source==='files'?'file settings':'preparation'}: <code>{selected?.trusted}</code></p>
    <p>Receiving request from your saved {source==='files'?'independent file':'preparation'}: <code>{selected?.buyer?.requestId}</code></p>
   </>}
   {record&&!journalComplete&&<p>Saved attempt: {record.attempt.phase} — {record.attempt.status}. Review it in the development harness; this page does not reset or retry it.</p>}
   <button className="btn" disabled={busy||!complete} onClick={()=>void run('verify')}>Verify saved transfer locally</button>
   <button className="btn" disabled={busy||!selected?.pkg} onClick={()=>{if(selected?.pkg)downloadJSON({kind:'counterfoil-signing-result',network:'testnet',final:{txid:selected.pkg.current.txid,atomicBeefBase64:selected.pkg.atomicBeefBase64}},'counterfoil-reopening-spv-evidence.json')}}>Download evidence for header sync</button>
   <p>If headers are missing, load that SPV download in <a href="/dev/feasibility" target="_blank" rel="noreferrer">Local SPV in the development harness</a>, sync while online, then return and verify here. The same browser profile and address origin are required. No headers are fetched during verification.</p>
   {verdict&&<div><h3>Saved transfer verification: {verdict.verdict}</h3><ul>{verdict.checks.map(check=><li key={check.name}>{check.name}: {check.status} — {check.reason}</li>)}</ul><p>Local verification server contacts: 0. {verdict.presentedTransferMined?'Presented transfer mining proof validated against saved headers.':'No validated mining status for the current transfer.'}</p><p>Checkpoint and declared-target proof-of-work checks only; full DAA and best-chain selection remain outside this experiment. Current unspentness and admission are not established.</p></div>}
  </section>
  <section className="wallet-panel" aria-label="Wallet key access">
   <h2>3. Check the wallet separately</h2>
   <p>This button uses local HTTP (3321), testnet and the original same-wallet identity. It requests a fresh challenge signature from the buyer’s receiving key and verifies it locally. It uses no transaction inputs or fees. Native wallet traffic is not monitored here; disable external networking for both app and wallet.</p>
   <label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>I authorize a one-time receiving-key challenge signature; no transaction will be created or broadcast.</label>
   <button className="btn" disabled={busy||!consent||verdict?.verdict!=='verified'} onClick={()=>void run('key')}>Check receiving key access</button>
   {phase==='key'&&<button className="btn" onClick={()=>active.current?.abort(new Error('Check cancelled. Dismiss any remaining wallet prompt.'))}>Cancel check</button>}
   {proof&&<p>Receiving-key challenge signature verified this session. This does not establish independent buyer custody.</p>}
   <details><summary>Key check wallet calls ({calls.length})</summary><ol>{calls.map((line,i)=><li key={i}>{line}</li>)}</ol></details>
   <p>For a later cold-wallet test, quit and reopen only the isolated test wallet while external networking remains disabled, then repeat this check. Record unlock failures and prompts. Browser automation alone cannot prove this works.</p>
  </section>
  <p role="status">{notice}</p>{error&&<p role="alert">{error}</p>}
  <button className="btn" disabled={busy||!verdict} onClick={download}>Download reopening observation</button>
  <p>Results are recomputed each session. The saved journal remains diagnostic evidence, not an accepted ticket or wallet backup. Opening this page makes no wallet requests.</p>
  <a href="/dev/feasibility">Back to development harness (online)</a>
 </main>
}
