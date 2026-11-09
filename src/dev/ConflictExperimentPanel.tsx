import {useEffect,useRef,useState} from 'react'
import type {WalletInterface} from '@bsv/sdk'
import {createConflictRun,listConflictRuns,loadConflictRun,updateConflictRun,conflictPersistence,type ConflictRecord} from '../conflicts/store.ts'
import {issueConflictFixture,refreshConflictIssuance,prepareConflictSigning,signConflictBranches,type ConflictSigningReview} from '../wallet/conflict-experiment.ts'
import {reviewConflictSubmission,submitConflictBranch,checkConflictBranch,verifyConflictSettlement,conflictPair,conflictTransport,type ConflictSubmissionReview} from '../conflicts/settlement.ts'
import {reviewConflictPair,doorVerdict} from '../conflicts/verify.ts'
import type {ConflictBranch,ConflictPairReview,ConflictVerdict} from '../conflicts/types.ts'
import {loadSnapshot} from '../headers/store.ts'
import {openWalletClient} from '../wallet/connection.ts'
import {minedCandidate} from '../settlement/evidence.ts'
import type {TicketPackage} from '../tickets/types.ts'
const VENUE='02828e341092c4a01d8b069b02fba9afc66092f4da2ddb14f4e101976675541d58'
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function spv(pkg:TicketPackage){return {kind:'counterfoil-signing-result',network:'testnet',final:{txid:pkg.current.txid,atomicBeefBase64:pkg.atomicBeefBase64}}}
type Action='create'|'issue'|'refresh'|'prepare'|'sign'|'verify'|'settlement'|'review'|'submit'|'status'
export function ConflictExperimentPanel(){
 const [records,setRecords]=useState<ConflictRecord[]>([]),[record,setRecord]=useState<ConflictRecord>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false)
 const [trusted,setTrusted]=useState(VENUE),[eventId,setEventId]=useState('counterfoil-conflict-test'),[ticketId,setTicketId]=useState<string>(()=>crypto.randomUUID())
 const [issueConsent,setIssueConsent]=useState(false),[signConsent,setSignConsent]=useState(false),[submitConsent,setSubmitConsent]=useState(false)
 const [prepared,setPrepared]=useState<ConflictSigningReview>(),[submission,setSubmission]=useState<ConflictSubmissionReview>(),[pairReview,setPairReview]=useState<ConflictPairReview>(),[verdict,setVerdict]=useState<Record<ConflictBranch,ConflictVerdict>>()
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[calls,setCalls]=useState<string[]>([]),[online,setOnline]=useState(navigator.onLine)
 const active=useRef<AbortController|null>(null),mounted=useRef(false)
 useEffect(()=>{mounted.current=true;void listConflictRuns().then(rs=>{if(mounted.current){setRecords(rs);setRecord(rs.at(-1));setLoaded(true)}}).catch(e=>{if(mounted.current)setError(String(e))});const connection=()=>setOnline(navigator.onLine);window.addEventListener('online',connection);window.addEventListener('offline',connection);return()=>{mounted.current=false;active.current?.abort();window.removeEventListener('online',connection);window.removeEventListener('offline',connection)}},[])
 function clear(){setIssueConsent(false);setSignConsent(false);setSubmitConsent(false);setPrepared(undefined);setSubmission(undefined);setPairReview(undefined);setVerdict(undefined);setNotice('');setError('')}
 async function select(id:string){if(active.current)return;clear();const r=records.find(x=>x.id===id);setRecord(r)}
 async function run(action:Action,branch?:ConflictBranch){
  if(active.current||!loaded||action!=='create'&&!record||action==='issue'&&!issueConsent||action==='sign'&&(!prepared||!signConsent)||action==='submit'&&(!submission||!submitConsent||submission.branch!==branch))return
  const c=new AbortController();active.current=c;setBusy(true);setNotice('');setError('');setCalls([]);setPairReview(undefined);setVerdict(undefined)
  const oldPrepared=prepared,oldSubmission=submission
  setIssueConsent(false);setSignConsent(false);setSubmitConsent(false);setPrepared(undefined);setSubmission(undefined)
  const timeout=setTimeout(()=>c.abort(new Error('Operation timed out; any dispatched action or signature may have completed. Review the saved diagnostic.')),60000)
  let id=record?.id
  const log=(line:string)=>{if(mounted.current&&!c.signal.aborted)setCalls(xs=>[...xs.slice(-127),line])}
  async function wallet(){const client=await openWalletClient('desktop-http',c.signal);return new Proxy(client,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return async(...args:unknown[])=>{log(`${String(key)} — started`);try{const result=await value.apply(target,args);log(`${String(key)} — returned`);return result}catch(e){log(`${String(key)} — failed`);throw e}}}}) as WalletInterface}
  try{
   if(action==='create'){const r=await createConflictRun({trusted,eventId,ticketId});id=r.id;if(mounted.current){setRecord(r);setNotice('Separate local record saved. No wallet request made.')}}
   else{
    const r=record!,store=conflictPersistence(r.id),deps={...store,headers:loadSnapshot,...conflictTransport,
     policy:async(s:AbortSignal)=>{log('ARC policy — started');const p=await conflictTransport.policy(s);log('ARC policy — returned');return p},
     status:async(txid:string,s:AbortSignal)=>{log('ARC status — started');const o=await conflictTransport.status(txid,s);log('ARC status — returned');return o},
     post:async(ef:string,txid:string,s:AbortSignal)=>{log('ARC submit — started');const o=await conflictTransport.post(ef,txid,s);log('ARC submit — returned');return o}}
    if(action==='issue'){await issueConflictFixture(await wallet(),r,c.signal,store);if(mounted.current)setNotice('Separate issuance and attestation saved. Wait for mining evidence before preparation.')}
    if(action==='refresh'){const issuance=await refreshConflictIssuance(await wallet(),r,c.signal);c.signal.throwIfAborted();await updateConflictRun({...r,revision:r.revision+1,issuance},r.revision);if(mounted.current)setNotice('Mining evidence saved. Download issuance SPV evidence and sync its headers above.')}
    if(action==='prepare'){const p=await prepareConflictSigning(await wallet(),r,await loadSnapshot(),c.signal);if(mounted.current){setPrepared(p);setNotice('Mined fixture verified and keys checked. Save all evidence and requests before disconnecting.')}}
    if(action==='sign'){await signConflictBranches(await wallet(),oldPrepared!,c.signal,store,loadSnapshot);if(mounted.current)setNotice('Both signed conflict branches saved locally. Neither branch was broadcast.')}
    async function checkedLocal<T>(verify:(snapshot:Awaited<ReturnType<typeof loadSnapshot>>)=>Promise<T>){
     const snapshot=await loadSnapshot()
     async function current(){c.signal.throwIfAborted();if(JSON.stringify(await store.load())!==JSON.stringify(r)||(await loadSnapshot())?.id!==snapshot?.id)throw new Error('Conflict evidence or headers changed; reload and verify again')}
     await current();const result=await verify(snapshot);await current();return result
    }
    if(action==='verify'){const result=await checkedLocal(snapshot=>reviewConflictPair(conflictPair(r),snapshot));if(mounted.current)setPairReview(result)}
    if(action==='review'){const reviewed=await reviewConflictSubmission(r,branch!,c.signal,deps);if(mounted.current)setSubmission(reviewed)}
    if(action==='submit'){const next=await submitConflictBranch(oldSubmission!,c.signal,deps);if(mounted.current)setNotice(`Branch ${branch!.toUpperCase()} submission ${next.attempts.at(-1)!.outcome}. Check status; this is not verified settlement.`)}
    if(action==='status'){await checkConflictBranch(r,branch!,c.signal,deps);if(mounted.current)setNotice('Provider observation saved. Reverify mining evidence locally.')}
    if(action==='settlement'){const result=await checkedLocal(snapshot=>verifyConflictSettlement(r,snapshot));if(mounted.current)setVerdict(result)}
   }
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Conflict experiment failed; save diagnostics before further action')}
  finally{clearTimeout(timeout);if(mounted.current){try{const rs=await listConflictRuns();if(mounted.current){setRecords(rs);const latest=id?await loadConflictRun(id):undefined;setRecord(latest)
    if(['verify','settlement','prepare','review'].includes(action)&&latest?.revision!==record?.revision){setPairReview(undefined);setVerdict(undefined);setPrepared(undefined);setSubmission(undefined);setError('Conflict evidence changed; reload and verify again')}}}catch(e){setLoaded(false);setError(`Storage unavailable; do not repeat any action: ${String(e)}`)}if(mounted.current){setBusy(false);active.current=null}}}
 }
 const disabled=busy||!loaded,blocked=record?.attempts.some(a=>a.outcome!=='complete'),signed=record?.attempts.some(a=>a.phase.startsWith('sign-'))
 return <section className="wallet-panel" aria-label="Controlled conflicting transfers.">
  <p className="eyebrow">SEPARATE TESTNET FIXTURE / EXPLICIT CONFLICT EXPERIMENT</p><h2>Controlled conflicting transfers.</h2>
  <p>Test two signed transfers of the same fresh ticket. This does not use your previously imported ticket. Both buyers are different keys in the same isolated wallet; independent buyer custody remains untested.</p>
  <p>Browser reports {online?'online':'offline'}. Calls logged this operation: {calls.length}. Native wallet traffic is not monitored. Local verification makes no wallet or server requests.</p>
  <label>Conflict run<select disabled={disabled} value={record?.id??''} onChange={e=>void select(e.target.value)}><option value="">Choose a saved run</option>{records.map(r=><option key={r.id} value={r.id}>{r.ticketId} — {r.id}</option>)}</select></label>
  <button className="btn" disabled={disabled} onClick={()=>{clear();void listConflictRuns().then(rs=>{setRecords(rs);setRecord(rs.find(r=>r.id===record?.id))}).catch(e=>setError(String(e)))}}>Reload conflict record</button>
  <details><summary>Create a separate fixture record</summary><label>Conflict venue identity<input disabled={disabled} value={trusted} onChange={e=>setTrusted(e.target.value)}/></label><label>Conflict event ID<input disabled={disabled} value={eventId} onChange={e=>setEventId(e.target.value)}/></label><label>Conflict ticket ID<input disabled={disabled} value={ticketId} onChange={e=>setTicketId(e.target.value)}/></label><button className="btn" disabled={disabled} onClick={()=>void run('create')}>Create separate local conflict record</button><p>This saves configuration only. Do not create another run to bypass an uncertain attempt.</p></details>
  <h3>1. Fund the separate fixture online</h3>
  {record&&<p>Run: <code className="experiment-id">{record.id}</code>. Ticket: {record.ticketId}. Trusted venue: <code className="experiment-id">{record.trusted}</code>.</p>}
  <p>New outputs: ticket 1 satoshi, fee A 1,000 satoshis, fee B 1,000 satoshis, plus wallet funding, change and issuance fees. Issuance broadcasts once; venue attestation follows. An attestation failure can leave an already-broadcast issuance.</p>
  <label className="experiment-check"><input type="checkbox" disabled={disabled||!record||!!record.attempts.length} checked={issueConsent} onChange={e=>setIssueConsent(e.target.checked)}/>I authorize this NEW conflict fixture, its testnet issuance broadcast, funding and venue attestation.</label>
  <button className="btn" disabled={disabled||!record||!!record.attempts.length||!issueConsent} onClick={()=>void run('issue')}>Issue and broadcast conflict fixture</button>
  {record?.issued&&<p>Separate issuance: <code className="experiment-id">{record.issued.txid}.0</code></p>}
  {record&&<><button className="btn" disabled={disabled} onClick={()=>download(`counterfoil-conflict-${record.id}-diagnostic.json`,{kind:'counterfoil-conflict-diagnostic',record})}>Download conflict diagnostic</button><ul>{record.attempts.map(a=><li key={a.id}>{a.phase}: {a.outcome}{a.reference&&<> — <code className="experiment-id">{a.reference}</code></>}</li>)}</ul></>}
  {blocked&&<p role="alert">An attempt is pending or uncertain. Further mutations are blocked. Save the diagnostic and review wallet/provider state; do not clear storage or create a replacement run to retry.</p>}
  <h3>2. Prepare while online</h3>
  <button className="btn" disabled={disabled||!record?.issuance||!!signed||!!blocked} onClick={()=>void run('refresh')}>Refresh conflict issuance mining evidence</button>
  {record?.issuance&&<><button className="btn" disabled={disabled} onClick={()=>download('counterfoil-conflict-issuance-spv.json',spv(record.issuance!))}>Download conflict issuance SPV evidence</button><button className="btn" disabled={disabled} onClick={()=>download('counterfoil-conflict-issuance.json',record.issuance)}>Download conflict issuance package</button></>}
  <p>Load the issuance SPV download in Local SPV above and sync while online. This experiment uses the same local header store and its checkpoint/DAA limits.</p>
  <button className="btn" disabled={disabled||!record?.issuance||!!signed||!!blocked} onClick={()=>void run('prepare')}>Prepare conflict branches for offline signing</button>
  {record?.keys&&(['source','a','b'] as const).map(b=><button className="btn" key={b} disabled={disabled} onClick={()=>download(`counterfoil-conflict-request-${b}.json`,record.keys![b])}>Download {b==='source'?'source':`buyer ${b.toUpperCase()}`} request</button>)}
  <h3>3. Sign offline, then verify each branch</h3>
  <p>Keep the local wallet and this tab running. Both branches spend the same ticket; A uses fee output 1, B uses fee output 2. Each pays 1,000 testnet satoshis if mined and creates a 1-satoshi ticket for its displayed buyer. Four transaction signatures are requested through the wallet. Signing does not broadcast or update the wallet's spend/reservation records; signed bytes cannot be revoked by closing this page.</p>
  {record?.keys&&(['a','b'] as const).map(b=><p key={b}>Buyer {b.toUpperCase()}: <code className="experiment-id">{record.keys![b].recipient.publicKey}</code></p>)}
  <label className="experiment-check"><input type="checkbox" disabled={disabled||!prepared} checked={signConsent} onChange={e=>setSignConsent(e.target.checked)}/>I saved the fixture and both buyer requests, disabled external internet for app and wallet, and authorize signing both conflicting transfers.</label>
  <button className="btn" disabled={disabled||!prepared||!signConsent||!!blocked} onClick={()=>void run('sign')}>Sign both conflict branches offline</button>
  {record&&(['a','b'] as const).map(b=>record.branches[b]&&<div key={b}><p>Branch {b.toUpperCase()}: <code className="experiment-id">{record.branches[b]!.pkg.current.txid}.0</code>. Package: {new TextEncoder().encode(JSON.stringify(record.branches[b]!.pkg)).length} bytes.</p><button className="btn" disabled={disabled} onClick={()=>download(`counterfoil-conflict-${b}-ticket.json`,record.branches[b]!.pkg)}>Download branch {b.toUpperCase()} ticket</button></div>)}
  <button className="btn" disabled={disabled||!record?.branches.a||!record.branches.b} onClick={()=>void run('verify')}>Verify both branches locally</button>
  {pairReview&&<div><h3>Pair verification: {pairReview.verdict}</h3><p>{pairReview.reason}</p>{(['a','b'] as const).map(b=><div key={b}><p>Branch {b.toUpperCase()}: {pairReview.checks[b].verdict}. Door policy: {doorVerdict(pairReview.checks[b])}.</p><ul>{pairReview.checks[b].checks.map(c=><li key={c.name}>{c.name}: {c.status} — {c.reason}</li>)}</ul></div>)}<p>Verification server contacts: 0. Having both packages reveals their shared spend. A disconnected scanner seeing only one unmined branch cannot detect the unseen branch.</p></div>}
  <h3>4. Reconnect and publish explicitly</h3>
  <p>Publishing either branch cannot be undone. Submit each only after its own review. The provider response is separate from verified mining evidence. The losing branch's fee output may remain unspent; no automatic cleanup or wallet import runs here.</p>
  {record&&(['a','b'] as const).map(b=><div key={b}><h4>Branch {b.toUpperCase()}</h4><button className="btn" disabled={disabled||!record.branches.a||!record.branches.b||!!blocked||record.attempts.some(a=>a.phase===`submit-${b}`)} onClick={()=>void run('review',b)}>Review branch {b.toUpperCase()} for submission</button><button className="btn" disabled={disabled||!record.branches[b]} onClick={()=>void run('status',b)}>Check branch {b.toUpperCase()} status</button><p>Latest provider status: {record.observations[b]?.at(-1)?.value?.txStatus??(record.observations[b]?.length?'not found':'not checked')}.</p></div>)}
  {submission&&<div><p>Reviewed branch {submission.branch.toUpperCase()}: <code className="experiment-id">{submission.transfer.txid}</code>. Fee: {submission.transfer.fee} testnet satoshis. Transaction: {submission.transfer.rawBytes} bytes. Provider policy: {submission.policy.feeSatoshis} satoshis per {submission.policy.feeBytes} bytes.</p><p>Inputs:</p><ul>{submission.transfer.inputs.map(i=><li key={i.index}><code className="experiment-id">{i.txid}.{i.index}</code>: {i.satoshis} satoshis</li>)}</ul><p>Recipient: <code className="experiment-id">{submission.transfer.evidence.buyer.recipient.publicKey}</code></p><label className="experiment-check"><input type="checkbox" disabled={disabled} checked={submitConsent} onChange={e=>setSubmitConsent(e.target.checked)}/>I authorize publishing only this exact reviewed branch to testnet, spending its inputs and embedded fee.</label><button className="btn" disabled={disabled||!submitConsent} onClick={()=>void run('submit',submission.branch)}>Submit reviewed conflict branch</button></div>}
  <button className="btn" disabled={disabled||!record?.branches.a||!record.branches.b} onClick={()=>void run('settlement')}>Verify conflict mining evidence locally</button>
  {record&&(['a','b'] as const).map(b=>{const o=record.observations[b]?.at(-1)?.value;return o?.merklePath&&record.branches[b]&&<button className="btn" key={b} disabled={disabled} onClick={()=>{try{download(`counterfoil-conflict-${b}-candidate-spv.json`,spv(minedCandidate(record.branches[b]!,o).pkg))}catch(e){setError(String(e))}}}>Download branch {b.toUpperCase()} candidate SPV evidence</button>})}
  {record&&(['a','b'] as const).map(b=>{const o=record.observations[b]?.at(-1)?.value;return o?.merklePath&&record.branches[b]&&<button className="btn" key={b} disabled={disabled} onClick={()=>{try{download(`counterfoil-conflict-${b}-updated-ticket.json`,minedCandidate(record.branches[b]!,o).pkg)}catch(e){setError(String(e))}}}>Download branch {b.toUpperCase()} updated ticket for scanner</button>})}
  {verdict&&(['a','b'] as const).map(b=><p key={b}>Branch {b.toUpperCase()}: {verdict[b].verdict} — {verdict[b].reason}</p>)}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}{busy&&<button className="btn" onClick={()=>active.current?.abort(new Error('Waiting cancelled; dispatched actions may have completed. Do not retry.'))}>Cancel waiting for conflict operation</button>}
  <details><summary>Conflict operation log ({calls.length})</summary><ol>{calls.map((c,i)=><li key={i}>{c}</li>)}</ol></details>
  <p>Only complete branches can be exported. Downloads are diagnostic evidence, not wallet backups or accepted tickets. Reload loses signing/submission authorization; uncertain attempts remain blocked. Current unspentness, full DAA/best-chain selection, independent buyer custody and admission are not established.</p>
 </section>
}
