import {useEffect,useRef,useState} from 'react'
import type {WalletInterface} from '@bsv/sdk'
import {canReviewMinedSourceFailure,claimExperiment,loadExperiment,saveExperiment,type ExperimentRecord,type DiagnosticFailure} from '../tickets/experiment-store.ts'
import {loadSnapshot} from '../headers/store.ts'
import {openWalletClient} from '../wallet/connection.ts'
import {summarizeError,type WalletFailureResponse} from '../wallet/diagnostics.ts'
import type {TicketPreparation} from '../wallet/ticket-experiment.ts'
const DEFAULT_VENUE='02828e341092c4a01d8b069b02fba9afc66092f4da2ddb14f4e101976675541d58'
type Phase='issue'|'refresh'|'prepare'|'transfer'|'review'
function download(name:string,value:unknown){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a')
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function DurableTicketPanel():React.JSX.Element{
 const [record,setRecord]=useState<ExperimentRecord>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[storageFailed,setStorageFailed]=useState(false)
 const [trusted,setTrusted]=useState(DEFAULT_VENUE),[eventId,setEventId]=useState('counterfoil-poc'),[ticketId,setTicketId]=useState<string>(()=>crypto.randomUUID())
 const [authorized,setAuthorized]=useState(false),[isolated,setIsolated]=useState(false),[saved,setSaved]=useState(false)
 const [prep,setPrep]=useState<TicketPreparation>(),[notice,setNotice]=useState(''),[error,setError]=useState(''),[calls,setCalls]=useState<string[]>([])
 const [failure,setFailure]=useState<DiagnosticFailure>()
 const active=useRef<AbortController|undefined>(undefined),mounted=useRef(false)
 useEffect(()=>{
  mounted.current=true;let cancelled=false
  void loadExperiment().then(r=>{if(cancelled)return;setRecord(r);setFailure(r?.failure);setLoaded(true);if(r)setNotice('Saved diagnostic loaded. Wallet readiness must be checked again.')})
   .catch(e=>{if(!cancelled){setStorageFailed(true);setError(`Diagnostic storage unavailable: ${summarizeError(e).message??'read failed'}`)}})
  return()=>{cancelled=true;mounted.current=false;active.current?.abort()}
 },[])
 const blocked=record!==undefined&&record.attempt.status!=='complete'
 const issued=record?.attempt.status==='complete'&&record.attempt.phase==='issue'
 const reviewable=record!==undefined&&canReviewMinedSourceFailure(record)
 const disabled=busy||!loaded||storageFailed
 async function run(phase:Phase){
  const mutation=phase==='issue'||phase==='transfer'
  if(active.current||disabled||phase==='review'&&!reviewable||phase==='issue'&&(!authorized||record)||phase==='transfer'&&(!issued||!prep||!isolated||!saved)||(phase==='refresh'||phase==='prepare')&&!issued)return
  setBusy(true);setError('');setNotice('');setFailure(undefined)
  if(phase!=='transfer'){setPrep(undefined);setSaved(false);setIsolated(false)}
  const c=new AbortController();active.current=c
  const current=()=>mounted.current&&active.current===c&&!c.signal.aborted
  let working=record,claimed=false,method:string|undefined,response:WalletFailureResponse|undefined,timer:ReturnType<typeof setTimeout>|undefined
  async function persist(next:ExperimentRecord){
   c.signal.throwIfAborted()
   try{working=await saveExperiment(working,next);if(current())setRecord(working)}
   catch(e){if(current())setStorageFailed(true);throw e}
   c.signal.throwIfAborted()
  }
  try{
   await Promise.race([(async()=>{
    if(mutation){working=await claimExperiment(working,{trusted,eventId,ticketId});claimed=true;if(current())setRecord(working);c.signal.throwIfAborted()}
    const client=await openWalletClient('desktop-http',c.signal,r=>{if(current())response=r})
    const allowed=new Set(mutation?['getNetwork','getPublicKey','createAction','createSignature','signAction']:['getNetwork','getPublicKey','listOutputs'])
    const wallet=new Proxy(client,{get(target,key){
     if(typeof key!=='string'||!allowed.has(key))throw new Error('Unsupported durable experiment method')
     return async(...args:unknown[])=>{
      c.signal.throwIfAborted();method=key;if(current())setCalls(p=>[...p.slice(-199),`${key} — started`])
      try{
       const fn=target[key as keyof WalletInterface] as (...a:unknown[])=>Promise<unknown>,result=await fn.apply(target,args)
       c.signal.throwIfAborted()
       if(mutation&&(key==='createAction'||key==='signAction')){
        const action=result as {txid?:string;signableTransaction?:{reference?:string}},ref=action.signableTransaction?.reference??action.txid
        if(ref&&working)await persist({...working,revision:working.revision+1,references:[...working.references,ref]})
       }
       if(current())setCalls(p=>[...p.slice(-199),`${key} — returned`]);return result
      }catch(e){if(current())setCalls(p=>[...p.slice(-199),`${key} — failed`]);throw e}
     }
    }})
    const module=await import('../wallet/ticket-experiment.ts');c.signal.throwIfAborted()
    if(phase==='issue'){
     const result=await module.issueTicketExperiment(wallet,working!.trusted,working!.eventId,working!.ticketId,working!.id,undefined,'broadcast')
     await persist({...working!,revision:working!.revision+1,pkg:result.pkg,buyer:result.destination,attempt:{...working!.attempt,status:'complete'}})
     if(current())setNotice('Issuance saved. Mining is not yet verified.')
    }else if(phase==='transfer'){
     const pkg=await module.transferTicketExperiment(wallet,prep!)
     await persist({...working!,revision:working!.revision+1,pkg,attempt:{...working!.attempt,status:'complete'}})
     if(current()){setPrep(undefined);setNotice('Signed transfer saved locally — not broadcast.')}
    }else{
     const durable=await import('../wallet/durable-ticket.ts');c.signal.throwIfAborted()
     if(phase==='review'){
      const result=await durable.recoverMinedSourcePreflight(wallet,working!,await loadSnapshot())
      await persist(result.record)
      if(current()){setPrep(result.preparation);setNotice('Preflight failure reviewed. Original failure retained; mined ticket preparation restored. Download the updated evidence before disconnecting.')}
     }else if(phase==='refresh'){
      const pkg=await durable.refreshIssuanceEvidence(wallet,working!.pkg!,working!.trusted)
      await persist({...working!,revision:working!.revision+1,pkg})
      if(current())setNotice('Wallet mining evidence saved. Download SPV evidence and sync its required headers above, then prepare the mined transfer.')
     }else{
      const result=await durable.prepareMinedTransfer(wallet,working!.pkg!,working!.buyer!,working!.trusted,await loadSnapshot())
      await persist({...working!,revision:working!.revision+1,pkg:result.pkg})
      if(current()){setPrep(result);setNotice('Mined issuance verified against local headers. Download the package before disconnecting. Offline fee allocation still needs testing.')}
     }
    }
   })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(new Error(mutation?'Wallet attempt timed out; its outcome may be unknown.':'Read-only wallet check timed out.'))},60000)})]
   )
  }catch(e){
   c.abort()
   const details:DiagnosticFailure={...summarizeError(e),method,walletResponse:response}
   // Preserve a pending claim if writing the failure fails. Either state blocks repeats.
   if(claimed&&working?.attempt.status==='pending'){
    try{working=await saveExperiment(working,{...working,revision:working.revision+1,attempt:{...working.attempt,status:'failed'},failure:details})}
    catch{if(mounted.current)setStorageFailed(true)}
   }
   if(mounted.current&&active.current===c){setRecord(working);setFailure(details);setError(details.message??'Wallet check failed');setPrep(undefined)}
  }finally{clearTimeout(timer);if(active.current===c){active.current=undefined;if(mounted.current)setBusy(false)}}
 }
 const pkg=record?.pkg
 return <section className="wallet-panel durable-ticket-panel" aria-labelledby="durable-ticket-heading">
  <p className="eyebrow">ONLINE ISSUANCE / SAVED DIAGNOSTICS</p><h2 id="durable-ticket-heading">Durable issuance and offline resale.</h2>
  <p>This separate experiment broadcasts a new issuance through the wallet while online, waits for mining evidence, and then tests an unbroadcast offline transfer. Desktop HTTP, testnet, both holder keys in the same wallet.</p>
  <p>The previous staged ticket remains unresolved. Review its wallet actions and reserved inputs before authorizing a fresh issuance here. This does not recover or rebroadcast that ticket.</p>
  <label>Venue identity for durable issuance<input className="ticket-input" value={record?.trusted??trusted} disabled={disabled||!!record} onChange={e=>setTrusted(e.target.value)}/></label>
  <label>Durable event ID<input className="ticket-input" value={record?.eventId??eventId} disabled={disabled||!!record} onChange={e=>setEventId(e.target.value)}/></label>
  <label>Durable ticket ID<input className="ticket-input" value={record?.ticketId??ticketId} disabled={disabled||!!record} onChange={e=>setTicketId(e.target.value)}/></label>
  <p>One ticket output of 1 testnet satoshi, plus wallet funding, change and transaction fees. The venue attestation is requested after the transaction is returned. A failed attestation can therefore leave a broadcast issuance requiring review.</p>
  <label className="experiment-check"><input type="checkbox" checked={authorized} disabled={disabled||!!record} onChange={e=>setAuthorized(e.target.checked)}/>I authorize a NEW testnet ticket, its wallet broadcast and venue signature. Funding inputs and fees will be used.</label>
  <button className="btn" disabled={disabled||!authorized||!!record||!trusted||!eventId||!ticketId} onClick={()=>void run('issue')}>Issue and broadcast test ticket</button>
  {record&&<>
   <p>Saved attempt: {record.attempt.phase} — {record.attempt.status}.</p>
   {blocked&&<p className="wallet-error">Wallet outcome requires review. Further mutations are blocked.</p>}
   <button className="btn" disabled={busy} onClick={()=>download('counterfoil-durable-diagnostic.json',record)}>Download diagnostic record</button>
   {reviewable&&<><p>This saved error matches the old local mined-source check, before transfer creation. Review reads wallet evidence and revalidates mining against stored headers. On success it preserves the failure and restores preparation; it does not sign, broadcast, import or cancel.</p>
    <button className="btn" disabled={disabled} onClick={()=>void run('review')}>Review mined-source preflight failure</button></>}
   {record.recoveredPreflight&&<p>Earlier preflight failure retained in the diagnostic record. Preparation must still be repeated after reloading.</p>}
  </>}
  {pkg&&<>
   <p>Current outpoint: <code className="experiment-id">{pkg.current.txid}.{pkg.current.index}</code>. Retained transactions: {pkg.lineageRawTxs.length}.</p>
   <button className="btn" disabled={busy} onClick={()=>{download('counterfoil-durable-ticket-package.json',pkg);setSaved(true)}}>Download durable ticket package</button>
   <button className="btn" disabled={busy} onClick={()=>download('counterfoil-durable-receiving-request.json',pkg.request)}>Download current receiving request</button>
   <button className="btn" disabled={busy} onClick={()=>download('counterfoil-durable-buyer-request.json',record!.buyer)}>Download durable buyer request</button>
   <button className="btn" disabled={busy} onClick={()=>download('counterfoil-durable-spv-evidence.json',{kind:'counterfoil-signing-result',network:'testnet',final:{txid:pkg.current.txid,atomicBeefBase64:pkg.atomicBeefBase64}})}>Download durable SPV evidence</button>
   <h3>Prepare while online</h3>
   <p>Refresh the wallet evidence after mining. Load its SPV evidence into the Local SPV experiment above and sync any missing headers. Preparation validates the mined issuance locally and checks both receiving keys with the wallet.</p>
   <button className="btn" disabled={disabled||!issued} onClick={()=>void run('refresh')}>Refresh issuance mining evidence</button>
   <button className="btn" disabled={disabled||!issued} onClick={()=>void run('prepare')}>Prepare mined ticket for offline transfer</button>
   <h3>Disconnect external networking</h3>
   <p>Download the updated ticket package and both requests. Keep the local wallet and this tab running. Reloading retains the diagnostic but requires preparation again; offline app reopening is a separate test.</p>
   <label className="experiment-check"><input type="checkbox" disabled={disabled||!prep||!issued} checked={isolated} onChange={e=>setIsolated(e.target.checked)}/>I saved the updated evidence and disconnected external internet for the app and wallet.</label>
   <button className="btn" disabled={disabled||!issued||!prep||!saved||!isolated} onClick={()=>void run('transfer')}>Sign offline transfer</button>
  </>}
  {busy&&<p role="status">Waiting for wallet or storage; wallet requests stop waiting after 60 seconds.</p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="wallet-error">{error}</p>}
  {failure&&<details><summary>Durable experiment error details</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(failure,null,2)}</pre></details>}
  <details><summary>Durable experiment wallet calls ({calls.length})</summary><p>Method names only. Native wallet network traffic is not observed.</p><ol>{calls.map((call,i)=><li key={i}>{call}</li>)}</ol></details>
  <p className="boundary">The saved record is diagnostic evidence, not an accepted ticket or wallet backup. No wallet request runs on reload. Clearing browser storage removes the duplicate-attempt protection but does not undo wallet actions. No automatic retry or reset is provided. Full DAA, best-chain selection, independent buyer custody and admission remain untested.</p>
 </section>
}
