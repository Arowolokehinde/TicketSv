import {readReopeningEvidence,verifyReopeningEvidence,type ReopeningEvidence} from './evidence.ts'
const DB='counterfoil-reopening-evidence-v1'
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const req=indexedDB.open(DB,1)
 req.onupgradeneeded=()=>req.result.createObjectStore('evidence')
 req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)}
 req.onerror=req.onblocked=()=>reject(new Error('Reopening evidence storage unavailable'))
})}
export async function loadReopeningEvidence():Promise<ReopeningEvidence|undefined>{
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('evidence'),req=tx.objectStore('evidence').get('current')
  tx.oncomplete=()=>{db.close();try{resolve(req.result===undefined?undefined:readReopeningEvidence(req.result))}catch(e){reject(e)}}
  tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Could not read saved reopening evidence'))}
 })
}
export async function saveReopeningEvidence(value:unknown,expected:ReopeningEvidence|undefined):Promise<ReopeningEvidence>{
 const next=readReopeningEvidence(value)
 // Missing headers are allowed for diagnostic retention, failed crypto checks are not.
 const report=await verifyReopeningEvidence(next,undefined)
 if(report.verdict==='rejected')throw new Error('Loaded evidence rejected; previous saved evidence retained')
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('evidence','readwrite'),store=tx.objectStore('evidence'),req=store.get('current')
  let changed=false
  req.onsuccess=()=>{
   if(JSON.stringify(req.result)!==JSON.stringify(expected)){changed=true;tx.abort();return}
   store.put(next,'current')
  }
  tx.oncomplete=()=>{db.close();resolve(next)}
  tx.onerror=tx.onabort=()=>{db.close();reject(new Error(changed?'Saved evidence changed in another tab. Reload before replacing it.':'Evidence was not saved; previous evidence retained'))}
 })
}
