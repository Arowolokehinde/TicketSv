import {useEffect,useRef,useState} from 'react'
import type {WalletInterface} from '@bsv/sdk'
import type {ReceiveRequest,TicketPackage,Verification} from '../tickets/types.ts'
import {MAX_PACKAGE_BYTES,readReceiveRequest,readTicketPackage} from '../tickets/codec.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import {loadSnapshot} from '../headers/store.ts'
import {openWalletClient} from '../wallet/connection.ts'
import {summarizeError,type ErrorSummary,type WalletFailureResponse} from '../wallet/diagnostics.ts'
import type {TicketPreparation} from '../wallet/ticket-experiment.ts'
type FailureDetails=ErrorSummary&{phase:string;method:string|null;observedAt:string;walletResponse?:WalletFailureResponse}
const DEFAULT_VENUE='02828e341092c4a01d8b069b02fba9afc66092f4da2ddb14f4e101976675541d58'
const methods=new Set(['getNetwork','getPublicKey','createAction','createSignature','signAction'])
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function TicketExperimentPanel():React.JSX.Element{
 const [trusted,setTrusted]=useState(DEFAULT_VENUE),[eventId,setEventId]=useState('counterfoil-poc'),[ticketId,setTicketId]=useState<string>(()=>crypto.randomUUID())
 const [authorized,setAuthorized]=useState(false),[isolated,setIsolated]=useState(false),[downloaded,setDownloaded]=useState(false)
 const [started,setStarted]=useState(false),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[transferred,setTransferred]=useState(false)
 const [prep,setPrep]=useState<TicketPreparation>(),[pkg,setPkg]=useState<TicketPackage>(),[expected,setExpected]=useState<ReceiveRequest>(),[buyer,setBuyer]=useState<ReceiveRequest>()
 const [report,setReport]=useState<Verification>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[calls,setCalls]=useState<string[]>([]),[references,setReferences]=useState<string[]>([])
 const [failureDetails,setFailureDetails]=useState<FailureDetails>()
 const active=useRef<AbortController|undefined>(undefined),mounted=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();active.current=undefined}},[])
 const reset=()=>{setReport(undefined);setError('');setNotice('')}
 const message=(e:unknown)=>e instanceof Error?e.message.slice(0,350):'Experiment failed'
 async function load(file:File|undefined,kind:'package'|'request'|'buyer'){
  if(!file)return;reset();setBusy(true);if(kind==='package'){setPkg(undefined);setExpected(undefined);setBuyer(undefined);setDownloaded(false);setIsolated(false)}else if(kind==='buyer')setBuyer(undefined);else setExpected(undefined)
  try{if(file.size>MAX_PACKAGE_BYTES)throw new Error('Envelope exceeds 4 MiB limit');const bytes=new Uint8Array(await file.arrayBuffer());const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const value=kind==='package'?readTicketPackage(text):readReceiveRequest(text);if(mounted.current){if(kind==='package')setPkg(value as TicketPackage);else if(kind==='buyer')setBuyer(value as ReceiveRequest);else setExpected(value as ReceiveRequest)}}
  catch(e){if(mounted.current)setError(message(e))}finally{if(mounted.current)setBusy(false)}
 }
 async function verify(tampered=false){
  if(!pkg)return;reset();setBusy(true)
  try{const snapshot=await loadSnapshot();const candidate=structuredClone(pkg);if(tampered)candidate.issuance.ticketId+='-tampered';const result=await verifyTicket(candidate,{trustedVenueIdentity:trusted,expectedRequest:expected,snapshot});if(mounted.current){setReport(result);setNotice(tampered?'Checked a changed copy; the original package was not modified.':'Local checks only — no wallet or server requests.')}}
  catch(e){if(mounted.current)setError(message(e))}finally{if(mounted.current)setBusy(false)}
 }
 async function run(phase:'issue'|'transfer'|'recover'|'restore'){
  const readOnly=phase==='recover'||phase==='restore'
  if(active.current||busy||!readOnly&&(failed||transferred)||phase==='issue'&&started||phase==='transfer'&&!prep||readOnly&&!pkg||phase==='restore'&&(!buyer||started||failed||transferred))return
  reset();setFailureDetails(undefined);if(!readOnly)setStarted(true);else if(phase==='recover')setExpected(undefined);setBusy(true)
  const c=new AbortController();active.current=c;const current=()=>mounted.current&&active.current===c&&!c.signal.aborted
  let timer:ReturnType<typeof setTimeout>|undefined,method:string|null=null,walletResponse:WalletFailureResponse|undefined
  try{await Promise.race([(async()=>{
   const module=await import('../wallet/ticket-experiment.ts');c.signal.throwIfAborted()
   const client=await openWalletClient('desktop-http',c.signal,response=>{if(current())walletResponse=response})
   const allowed=readOnly?new Set(phase==='restore'?['getNetwork','getPublicKey','listOutputs']:['getNetwork','getPublicKey']):methods
   const wallet=new Proxy(client,{get(target,name){if(typeof name!=='string'||!allowed.has(name))throw new Error('Unsupported experiment method');return async(...args:unknown[])=>{c.signal.throwIfAborted();method=name;if(current())setCalls(p=>[...p,`${name} — started`]);try{const operation=target[name as keyof WalletInterface] as (...a:unknown[])=>Promise<unknown>;const value=await operation.apply(target,args);c.signal.throwIfAborted();method=name;if(current())setCalls(p=>[...p,`${name} — returned`]);return value}catch(e){if(current())setCalls(p=>[...p,`${name} — failed`]);throw e}}}})
   const remember=(r:string)=>{if(current())setReferences(p=>[...p,r])}
   if(phase==='recover'){const result=await module.confirmIssuanceRequest(wallet,pkg!,trusted);if(current()){setExpected(result);setNotice('Current-holder request confirmed with the wallet. Download it before continuing.')}}
   else if(phase==='restore'){const result=await module.restoreTicketPreparation(wallet,pkg!,buyer!,trusted);if(current()){setPrep(result);setExpected(result.source);setStarted(true);setDownloaded(false);setIsolated(false);setNotice('Transfer preparation restored from wallet records. No transaction was created or signed. Save the package before disconnecting.')}}
   else if(phase==='issue'){const result=await module.issueTicketExperiment(wallet,trusted,eventId,ticketId,crypto.randomUUID(),remember);if(current()){setPrep(result);setPkg(result.pkg);setExpected(result.source);setNotice('Signed issuance and venue attestation ready.')}}
   else{const result=await module.transferTicketExperiment(wallet,prep!,remember);if(current()){setPkg(result);setExpected(prep!.destination);setTransferred(true);setNotice('Signed successor package ready.')}}
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(new Error(readOnly?'Read-only wallet check timed out. No recovered result was accepted.':'The wallet attempt timed out; its outcome may be unknown.'))},60000)})])}
  catch(e){if(mounted.current&&active.current===c){if(!readOnly)setFailed(true);setFailureDetails({...summarizeError(e),phase,method,walletResponse,observedAt:new Date().toISOString()});setError(message(e))}}
  finally{clearTimeout(timer);if(active.current===c){active.current=undefined;if(mounted.current)setBusy(false)}}
 }
 return <section className="wallet-panel ticket-auth-panel" aria-labelledby="ticket-auth-heading">
  <p className="eyebrow">TRUSTED VENUE / RETAINED TICKET HISTORY</p><h2 id="ticket-auth-heading">Venue and ticket provenance.</h2>
  <p>Verify the venue signature, every designated ticket spend and the recipient locking key. This is a separate experiment: the earlier signing fixture is not an issued event ticket.</p>
  <label>Trusted venue identity<input className="ticket-input" value={trusted} disabled={busy||started} onChange={e=>{reset();setTrusted(e.target.value)}} /></label>
  <p>The default is the public identity previously observed in your isolated test wallet. Configure trust independently; importing a package never changes it.</p>
  <h3>Load existing evidence</h3>
  <label>Load ticket package<input type="file" accept=".json,application/json" disabled={busy||started} onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';void load(f,'package')}} /></label>
  <label>Load saved receiving request<input type="file" accept=".json,application/json" disabled={busy||started} onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';void load(f,'request')}} /></label>
  <p>Use the receiving request you saved independently before handoff, not a request supplied as the ticket’s ownership claim.</p>
  {pkg&&pkg.lineageRawTxs.length===1&&!prep&&<><p>Missing the original holder’s request? For this same-wallet issuance only, confirm its receiving key with your isolated testnet wallet. This reads public keys and network only; it does not restore transfer preparation or prove private-key possession.</p><button className="btn" disabled={busy} onClick={()=>void run('recover')}>Confirm current-holder request with wallet</button></>}
  {pkg&&pkg.lineageRawTxs.length===1&&!prep&&<>
   <h3>Resume the existing ticket transfer</h3>
   <p>For the isolated test build and this same-wallet issuance only. Load the buyer request saved before handoff. Restoration reads public keys and wallet output records; it creates no action, signature or broadcast. Keep the isolated wallet running. Missing funding stops recovery.</p>
   <label>Load prepared buyer request<input type="file" accept=".json,application/json" disabled={busy||started} onChange={e=>{const f=e.currentTarget.files?.[0];e.currentTarget.value='';void load(f,'buyer')}} /></label>
   {buyer&&<p>Prepared buyer request loaded: <code>{buyer.requestId}</code>.</p>}
   <button className="btn" disabled={busy||started||failed||transferred||!buyer} onClick={()=>void run('restore')}>Restore transfer preparation</button>
  </>}
  <h3>Or create a fresh wallet-backed fixture</h3>
  <p>Desktop HTTP, testnet, same wallet for both holder keys. Issuance reserves funding inputs and requests an attestation signature. Issuance and transfer use noSend; neither button broadcasts.</p>
  <label>Event ID<input className="ticket-input" value={eventId} disabled={busy||started} onChange={e=>setEventId(e.target.value)} /></label>
  <label>Ticket ID<input className="ticket-input" value={ticketId} disabled={busy||started} onChange={e=>setTicketId(e.target.value)} /></label>
  <label className="experiment-check"><input type="checkbox" checked={authorized} disabled={started} onChange={e=>setAuthorized(e.target.checked)}/>I authorize testnet issuance and an attestation signature; wallet inputs may be reserved.</label>
  <button className="btn" disabled={!authorized||started||busy||!eventId||!ticketId||!trusted} onClick={()=>void run('issue')}>Issue test ticket</button>
  {prep&&<><p>Both holder keys were prepared in this wallet. Save the issuance package, the current holder’s receiving request, and the prepared buyer request. The two requests belong to different stages.</p>
   <button className="btn" onClick={()=>download('counterfoil-prepared-buyer-request.json',prep.destination)}>Download prepared buyer request</button>
   <label className="experiment-check"><input type="checkbox" disabled={busy||failed||transferred} checked={isolated} onChange={e=>setIsolated(e.target.checked)}/>I saved the issuance package and disconnected external networking, keeping the local wallet running.</label>
   <button className="btn" disabled={!downloaded||!isolated||busy||failed||transferred} onClick={()=>void run('transfer')}>Sign test transfer</button></>}
  {pkg&&<><p>Current outpoint: <code className="experiment-id">{pkg.current.txid}.{pkg.current.index}</code>. Retained transactions: {pkg.lineageRawTxs.length}.</p>
   <div className="spv-actions"><button className="btn" disabled={busy} onClick={()=>{download('counterfoil-ticket-package.json',pkg);setDownloaded(true)}}>Download ticket package</button>
    {expected&&<button className="btn" disabled={busy} onClick={()=>download('counterfoil-receiving-request.json',expected)}>Download receiving request</button>}
    <button className="btn" disabled={busy} onClick={()=>download('counterfoil-ticket-spv-evidence.json',{kind:'counterfoil-signing-result',network:'testnet',final:{txid:pkg.current.txid,atomicBeefBase64:pkg.atomicBeefBase64}})}>Download SPV evidence</button>
    <button className="btn" disabled={busy} onClick={()=>void verify()}>Verify ticket locally</button><button className="btn" disabled={busy} onClick={()=>void verify(true)}>Check tampered copy</button></div></>}
  {busy&&<p role="status">{active.current?'Waiting for the wallet; this attempt stops waiting after 60 seconds.':'Checking local evidence…'}</p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<div className="wallet-error" role="alert"><p>{error}</p>{failed&&<p>Do not repeat issuance or transfer until wallet actions and reserved inputs have been reviewed. Refreshing or a lost response does not undo them.</p>}</div>}
  {failureDetails&&<div className="wallet-error">
   <details><summary>Error details</summary><p>Reported by the SDK or wallet. This does not establish whether an action was created. Download before refreshing; these details stay in this tab.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(failureDetails,null,2)}</pre></details>
   <button className="btn" onClick={()=>download('counterfoil-ticket-failure.json',{kind:'counterfoil-ticket-failure',failure:failureDetails,calls,references})}>Download failure details</button>
  </div>}
  {report&&<div className="wallet-evidence"><p>Ticket verification: {report.verdict}</p><ul>{report.checks.map((c,i)=><li key={i}>{c.name}: {c.status} — {c.reason}</li>)}</ul><p>{report.presentedTransferMined?'The current transaction has a proof in the validated snapshot.':'No validated mining status for the current transaction in this result.'}</p><p>Local verification server contacts: 0. Recipient-lock verification does not prove possession of the buyer’s private key.</p></div>}
  {!!references.length&&<details><summary>Ticket wallet action references</summary><ul>{references.map((r,i)=><li key={i}><code className="experiment-id">{r}</code></li>)}</ul><button className="btn" onClick={()=>download('counterfoil-ticket-action-references.json',{references,calls})}>Download action references</button></details>}
  <details><summary>Ticket experiment wallet calls ({calls.length})</summary><p>Method names only; native wallet traffic is not observed.</p><ol>{calls.map((c,i)=><li key={i}>{c}</li>)}</ol></details>
  <p className="boundary">To prepare headers for a new package, download SPV evidence, load it in the Local SPV experiment above and sync while online. Local SPV retains its checkpoint/DAA limits; missing or out-of-range headers leave verification incomplete. Packages and requests stay in this tab; downloads are diagnostic evidence, not accepted tickets. Current unspentness, independent buyer custody, offline reopening and admission remain separate tests.</p>
 </section>
}
