import {useEffect,useRef,useState} from 'react'
import type {ReopeningEvidence} from '../offline/evidence.ts'
import {savedImportCandidate as savedCandidate,type ImportSource as Source} from '../wallet/import-source.ts'
import {loadSnapshot} from '../headers/store.ts'
import {openWalletClient} from '../wallet/connection.ts'
import {reviewWalletImport,type ImportReview} from '../wallet/import-review.ts'

function download(result:ImportReview){
 const value={kind:'counterfoil-wallet-import-review',version:1,result,walletMutations:0,note:'Read-only same-wallet observation. Not proof of import, independent custody or current chain unspentness.'}
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='counterfoil-wallet-import-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function WalletImportReviewPanel():React.JSX.Element{
 const [source,setSource]=useState<Source>('download'),[evidence,setEvidence]=useState<ReopeningEvidence>(),[result,setResult]=useState<ImportReview>()
 const [busy,setBusy]=useState(false),[reviewing,setReviewing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[calls,setCalls]=useState<string[]>([])
 const mounted=useRef(true),sequence=useRef(0),active=useRef(false),operation=useRef<AbortController|null>(null)
 async function reload(selected:Source){
  if(active.current)return
  active.current=true;const seq=++sequence.current;setBusy(true);setResult(undefined);setEvidence(undefined);setError('');setNotice('');setCalls([])
  try{const next=await savedCandidate(selected);if(mounted.current&&seq===sequence.current){setEvidence(next);setNotice(next?'Saved mining evidence loaded. The wallet review will reverify it locally.':'No saved transfer at this browser origin. Select the original diagnostic or save downloaded evidence in the reopening experiment.')}}
  catch(e){if(mounted.current&&seq===sequence.current)setNotice(e instanceof Error?e.message:'Could not load saved mining evidence')}
  finally{if(mounted.current&&seq===sequence.current){active.current=false;setBusy(false)}}
 }
 useEffect(()=>{mounted.current=true;void reload('download');return()=>{mounted.current=false;sequence.current++;active.current=false;operation.current?.abort()}},[])
 async function review(){
  if(active.current||!evidence)return
  active.current=true;setBusy(true);setReviewing(true);setResult(undefined);setError('');setNotice('');setCalls([])
  const c=new AbortController(),seq=++sequence.current;operation.current=c
  const current=()=>mounted.current&&seq===sequence.current
  // Covers storage, verification, lazy loading and wallet calls; late work is ignored.
  let abortListener:()=>void=()=>{}
  const cancelled=new Promise<never>((_,reject)=>{abortListener=()=>reject(c.signal.reason);c.signal.addEventListener('abort',abortListener,{once:true})})
  const timer=setTimeout(()=>c.abort(new Error('Wallet review timed out. No import was performed.')),30000)
  try{
   const work=async()=>{
    const fresh=await savedCandidate(source),snapshot=await loadSnapshot();c.signal.throwIfAborted()
    if(!fresh||JSON.stringify(fresh)!==JSON.stringify(evidence))throw new Error('Saved evidence changed. Reload saved mining evidence before reviewing.')
    const checked=await reviewWalletImport(()=>openWalletClient('desktop-http',c.signal),fresh,snapshot,c.signal,line=>{if(current()&&!c.signal.aborted)setCalls(xs=>[...xs.slice(-31),line])})
    const after=await savedCandidate(source),headers=await loadSnapshot();c.signal.throwIfAborted()
    if(JSON.stringify(after)!==JSON.stringify(fresh)||headers?.id!==snapshot?.id)throw new Error('Saved evidence or headers changed during review. Reload and review again.')
    return checked
   }
   const checked=await Promise.race([work(),cancelled]);if(current())setResult(checked)
  }catch(e){if(current())setError(e instanceof Error?e.message:'Wallet review failed. No import was performed.')}
  finally{clearTimeout(timer);c.signal.removeEventListener('abort',abortListener);if(current()){active.current=false;setBusy(false);setReviewing(false);operation.current=null}}
 }
 return <section className="wallet-panel" aria-label="Wallet import review.">
  <p className="eyebrow">READ-ONLY / SAME-WALLET RECORD CHECK</p><h2>Wallet import review.</h2>
  <p>Check whether the mined buyer ticket is already recorded in the isolated testnet wallet. This reads public keys, wallet version and the experiment basket. It does not import, sign or broadcast anything.</p>
  <label>Wallet review evidence source<select value={source} disabled={busy} onChange={e=>{const selected=e.target.value as Source;setSource(selected);void reload(selected)}}><option value="download">Downloaded evidence saved on this device</option><option value="journal">Original experiment diagnostic</option></select></label>
  <button className="btn" disabled={busy} onClick={()=>void reload(source)}>Reload saved mining evidence</button>
  {evidence&&<><p>Ticket to review: <code className="experiment-id">{evidence.pkg.current.txid}.{evidence.pkg.current.index}</code></p><p>Independent receiving request: {evidence.buyer.requestId}</p></>}
  <p>Keep the isolated wallet open on testnet. Uses local HTTP (3321); native wallet network traffic is not monitored.</p>
  <button className="btn" disabled={busy||!evidence} onClick={()=>void review()}>Review wallet ticket record</button>
  {reviewing&&<button className="btn" onClick={()=>operation.current?.abort(new Error('Wallet review cancelled. No import was performed.'))}>Cancel wallet review</button>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  {result&&<div><h3>Wallet record: {result.state}</h3><p>{result.reason}</p><p>Observed at: {result.checkedAt}</p><p>Wallet interface version: {result.walletVersion}</p><p>Local header snapshot: <code className="experiment-id">{result.snapshotId}</code></p><button className="btn" disabled={busy} onClick={()=>download(result)}>Download wallet review observation</button></div>}
  <details><summary>Wallet review calls ({calls.length})</summary><p>Method names only; no wallet output records are included.</p><ol>{calls.map((line,i)=><li key={i}>{line}</li>)}</ol></details>
  <p>Results describe this review only. An existing record is not a successful import test; absence is not authorization to retry. Independent buyer custody, wallet import and lost-response reconciliation remain separate checks.</p>
 </section>
}
