import {checkedStatus} from '../headers/cached-sync.ts'
import {HEADER_BATCH_SIZE,decodeHeaderBatch,boundedBytes} from '../headers/batch.ts'
import {CHECKPOINT} from '../headers/checkpoint.ts'
import {appendSnapshot,type HeaderSnapshot} from '../headers/validate.ts'
import {loadSnapshot,saveSnapshot} from '../headers/store.ts'

export async function scannerJSON(path:string,signal:AbortSignal){
 const response=await fetch(path,{credentials:'same-origin',redirect:'error',cache:'no-store',signal})
 return JSON.parse(new TextDecoder().decode(await boundedBytes(response,2*1024*1024,signal))) as unknown
}
export async function prepareScannerHeaders(signal:AbortSignal,onProgress:(message:string)=>void=()=>{}){
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(120_000)])
 const status=checkedStatus(await scannerJSON('/api/headers/status',bounded))
 if(status.tip===null)throw Error('Shared headers are not ready yet. Prepare a mined ticket online first, then retry scanner preparation.')
 let snapshot=await loadSnapshot()
 const target=Math.max(status.tip,snapshot?.headers.at(-1)?.height??CHECKPOINT.height-1)
 while(!snapshot||snapshot.headers.at(-1)!.height<target){
  bounded.throwIfAborted()
  const old:HeaderSnapshot|undefined=snapshot,start=old?.headers.at(-1)?.height??CHECKPOINT.height
  const count=Math.min(HEADER_BATCH_SIZE,status.tip-start+1)
  if(count<1)break
  onProgress(`Saving headers ${start.toLocaleString()}–${(start+count-1).toLocaleString()}`)
  const response=await fetch(`/api/headers/range?start=${start}&count=${count}`,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:bounded})
  if(response.headers.get('X-TicketSV-Header-Start')!==String(start)||response.headers.get('X-TicketSV-Header-Count')!==String(count)||response.headers.get('X-TicketSV-Header-Network')!=='testnet'||response.headers.get('X-TicketSV-Header-Checkpoint')!==CHECKPOINT.hash||response.headers.get('X-TicketSV-Header-Comparison')!=='server-reported')throw Error('Shared header response is invalid. Saved progress retained.')
  const records=decodeHeaderBatch(await boundedBytes(response,count*80,bounded),start,count)
  if(old&&(records[0].hash!==old.headers.at(-1)!.hash||records[0].hex!==old.headers.at(-1)!.hex))throw Error('Saved header boundary changed. Operator review is required.')
  snapshot=appendSnapshot(old,records.slice(old?1:0),undefined,'ticketsv-cache')
  await saveSnapshot(snapshot,bounded,{id:old?.id})
 }
 if(!snapshot)throw Error('No validated scanner headers were saved.')
 return snapshot
}
