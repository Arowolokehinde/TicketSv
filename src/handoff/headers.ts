import {ApiFailure} from '../auth/api.ts'
import {validHeaderHeight} from '../headers/checkpoint.ts'
import {loadSnapshot,saveSnapshot,type SnapshotExpectation} from '../headers/store.ts'
import {pacedHeaderFetcher,syncHeaders,type HeaderSyncProgress} from '../headers/sync.ts'
import {SHARED_HEADERS_ENABLED,syncCachedHeaders} from '../headers/cached-sync.ts'
import {readSigningEvidenceBytes} from '../verification/signing-spv.ts'
import {fromBase64} from '../tickets/codec.ts'
export async function prepareHandoffHeaders(height:number,signal:AbortSignal,onProgress?:(p:HeaderSyncProgress)=>void){
 signal.throwIfAborted()
 if(!validHeaderHeight(height))throw Error('Invalid required header height.')
 let snapshot=await loadSnapshot();if(snapshot&&(snapshot.headers.at(-1)?.height??0)>=height)return snapshot
 if(!navigator.onLine)throw Error('Required headers are missing. Prepare this device while online.')
 let expected:SnapshotExpectation={id:snapshot?.id}
 const persist=async(next:NonNullable<typeof snapshot>)=>{signal.throwIfAborted();await saveSnapshot(next,signal,expected);expected={id:next.id}}
 if(SHARED_HEADERS_ENABLED){
  try{await syncCachedHeaders(height,snapshot,signal,onProgress,persist,{useCookieSession:true});return await loadSnapshot()}
  catch(error){signal.throwIfAborted();if(!(error instanceof ApiFailure && (error.status===401||error.status===409)))throw error;snapshot=await loadSnapshot();expected={id:snapshot?.id}}
 }
 const result=await syncHeaders(height,snapshot,pacedHeaderFetcher(()=>{}),signal,onProgress,{onCheckpoint:persist});await persist(result.snapshot);return await loadSnapshot()
}
export function requiredHeaderHeight(txid:string,beef:string){return readSigningEvidenceBytes(txid,fromBase64(beef)).requiredHeight}
