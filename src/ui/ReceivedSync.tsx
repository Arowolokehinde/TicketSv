import {useEffect,useRef,useState} from 'react'
import {signedInSync} from '../handoff/sync.ts'

// Outside AuthProvider so local evidence can still be opened without a session.
// No login, wallet action, provider status request or verification is automatic.
export function ReceivedSync({onRestored}:{onRestored:()=>Promise<void>}){
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),active=useRef<AbortController|null>(null),again=useRef(false),alive=useRef(true)
 const refreshed=useRef(onRestored);refreshed.current=onRestored
 async function sync(){
  if(active.current){again.current=true;return}
  const c=new AbortController();active.current=c;setBusy(true);let passed=false
  try{const result=await signedInSync(c.signal);c.signal.throwIfAborted();await refreshed.current();passed=true;setMessage(`Account synchronised. ${result.uploaded} update(s) saved; ${result.restored} ticket(s) recovered. Verify evidence again for a fresh result.`)}
  catch(e){if(!c.signal.aborted)setMessage((e as Error).message)}
  finally{if(active.current===c){active.current=null;if(alive.current)setBusy(false);if(passed&&again.current&&alive.current){again.current=false;void sync()}}}
 }
 useEffect(()=>{
  alive.current=true
  const changed=()=>{if(navigator.onLine)void sync()}
  addEventListener('online',changed);addEventListener('ticketsv-handoff-saved',changed)
  return()=>{alive.current=false;active.current?.abort();removeEventListener('online',changed);removeEventListener('ticketsv-handoff-saved',changed)}
 },[])
 return <div className="received-sync"><button className="btn" disabled={busy||!navigator.onLine} onClick={()=>void sync()}>{busy?'Synchronising…':'Sync received tickets with account'}</button>{message&&<p role="status">{message}</p>}</div>
}
