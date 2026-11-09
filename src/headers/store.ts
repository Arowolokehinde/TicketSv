import { validateSnapshot, snapshotParent, type HeaderSnapshot } from './validate.ts'
import { CHECKPOINT, validHeaderHeight } from './checkpoint.ts'
export const HEADER_DB='counterfoil-spv-experiment-v1'
const CHUNK_SIZE=512
const CHUNKED='ticketsv-header-chunks-v1'
export type SnapshotExpectation={id:string|undefined}|{storedJSON:string|undefined}
type Metadata=Omit<HeaderSnapshot,'headers'> & {kind:typeof CHUNKED;length:number}
type Stored={metadata:unknown;chunks?:unknown[];value:unknown}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const request=indexedDB.open(HEADER_DB,2)
 request.onupgradeneeded=()=>{
  if(!request.result.objectStoreNames.contains('snapshots'))request.result.createObjectStore('snapshots')
  if(!request.result.objectStoreNames.contains('chunks'))request.result.createObjectStore('chunks')
 }
 request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)}
 request.onerror=()=>reject(new Error('Header storage could not be opened'))
 request.onblocked=()=>reject(new Error('Header storage is blocked by another tab'))
})}
function chunked(value:unknown):value is Metadata{return !!value && typeof value==='object' && (value as Metadata).kind===CHUNKED}
// Read metadata and its chunks within the same transaction. A reader cannot see
// a partially committed append. Invalid storage still gets an exact recheck token.
function read(tx:IDBTransaction,done:(stored:Stored)=>void,includeChunks=true){
 const request=tx.objectStore('snapshots').get('accepted')
 request.onsuccess=()=>{
  const metadata:unknown=request.result
  if(!chunked(metadata)||!includeChunks){done({metadata,value:metadata});return}
  const chunks=tx.objectStore('chunks').getAll()
  chunks.onsuccess=()=>{
   const parts:unknown[]=chunks.result
   const valid=Number.isSafeInteger(metadata.length) && metadata.length>0 && validHeaderHeight(CHECKPOINT.height+metadata.length-1) &&
    parts.length===Math.ceil(metadata.length/CHUNK_SIZE) && parts.every((p,i)=>Array.isArray(p)&&p.length===Math.min(CHUNK_SIZE,metadata.length-i*CHUNK_SIZE))
   const {kind:_kind,length:_length,...fields}=metadata
   done({metadata,chunks:parts,value:valid?{...fields,headers:parts.flat()}:metadata})
  }
 }
}
function token(stored:Stored):string|undefined{
 // Preserve legacy exact-comparison tokens. Chunked tokens cover both metadata
 // and all stored bytes, including malformed chunks during explicit recovery.
 return stored.chunks?JSON.stringify({metadata:stored.metadata,chunks:stored.chunks}):JSON.stringify(stored.metadata)
}
async function readStored():Promise<Stored>{
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['snapshots','chunks'],'readonly');let stored:Stored
  read(tx,value=>{stored=value})
  tx.oncomplete=()=>{db.close();resolve(stored)}
  tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Header storage read failed'))}
 })
}
export async function loadSnapshot():Promise<HeaderSnapshot|undefined>{
 const {value}=await readStored()
 try{return value===undefined?undefined:validateSnapshot(value)}catch{throw new Error('Stored headers failed validation — use Recheck all headers while online')}
}
export async function loadSnapshotForRecheck():Promise<{snapshot:HeaderSnapshot|undefined;expected:SnapshotExpectation}>{
 const stored=await readStored(),expected={storedJSON:token(stored)}
 try{return {snapshot:stored.value===undefined?undefined:validateSnapshot(stored.value),expected}}
 catch{return {snapshot:undefined,expected}}
}
export async function saveSnapshot(value:HeaderSnapshot,signal?:AbortSignal,expected?:SnapshotExpectation):Promise<void>{
 const snapshot=validateSnapshot(value);signal?.throwIfAborted();const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['snapshots','chunks'],'readwrite'),store=tx.objectStore('snapshots'),chunks=tx.objectStore('chunks')
  let conflict=false
  const abort=()=>{try{tx.abort()}catch{/* transaction already finished */}}
  signal?.addEventListener('abort',abort,{once:true})
  const cleanup=()=>{signal?.removeEventListener('abort',abort);db.close()}
  tx.oncomplete=()=>{cleanup();resolve()}
  tx.onabort=tx.onerror=()=>{cleanup();reject(new Error(conflict?'Headers changed in another tab; sync again to use the latest saved progress.':'Header snapshot was not saved; previous snapshot retained'))}
  if(signal?.aborted){abort();return}
  read(tx,stored=>{
   try{
    const old=stored.metadata as Partial<Metadata>|undefined
    if(expected && ('storedJSON' in expected?token(stored)!==expected.storedJSON:old?.id!==expected.id)){conflict=true;abort();return}
    const source=expected && !('storedJSON' in expected) && old?.source==='ticketsv-cache'?'ticketsv-cache':snapshot.source
    const parent=snapshotParent(snapshot)
    // Only a validated append from this exact saved parent may reuse disk chunks.
    // Explicit full rechecks and legacy migrations replace chunks atomically.
    const offset=chunked(old) && parent?.id===old.id && parent.length===old.length ? Math.floor(parent.length/CHUNK_SIZE)*CHUNK_SIZE : 0
    if(!offset)chunks.clear()
    for(let i=offset;i<snapshot.headers.length;i+=CHUNK_SIZE)chunks.put(snapshot.headers.slice(i,i+CHUNK_SIZE),i/CHUNK_SIZE)
    const {headers,...fields}=snapshot
    store.put({...fields,...(source?{source}:{}),kind:CHUNKED,length:headers.length},'accepted')
   }catch{abort()}
  },!!expected && 'storedJSON' in expected)
 })
}
