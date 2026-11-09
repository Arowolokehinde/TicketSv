import {ARC_TESTNET,type ArcObservation,type ArcPolicy} from './types.ts'
export {ARC_TESTNET} from './types.ts'
const HASH=/^[0-9a-f]{64}$/
const HEX=/^(?:[0-9a-f]{2})+$/
const MAX_RESPONSE=4*1024*1024
const statuses=new Set(['UNKNOWN','QUEUED','RECEIVED','STORED','ANNOUNCED_TO_NETWORK','REQUESTED_BY_NETWORK','SENT_TO_NETWORK','ACCEPTED_BY_NETWORK','SEEN_IN_ORPHAN_MEMPOOL','SEEN_ON_NETWORK','SEEN_MULTIPLE_NODES','DOUBLE_SPEND_ATTEMPTED','REJECTED','MINED_IN_STALE_BLOCK','MINED','IMMUTABLE'])
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid ARC response');return v as Record<string,unknown>}
function txid(v:string){if(!HASH.test(v))throw new Error('Invalid transaction ID')}
export function parseObservation(value:unknown,expected:string):ArcObservation{
 txid(expected);const v=object(value)
 if(v.txid!==expected)throw new Error('ARC response is for another transaction')
 if(typeof v.txStatus!=='string'||!statuses.has(v.txStatus)){
  const detail=typeof v.txStatus==='string'&&/^[A-Z_]{1,64}$/.test(v.txStatus)?` (${v.txStatus})`:''
  throw new Error(`Unrecognized ARC transaction status${detail}. Mining is not confirmed; check again later.`)
 }
 const out:ArcObservation={txid:expected,txStatus:v.txStatus,observedAt:new Date().toISOString()}
 if(v.blockHeight!==undefined&&v.blockHeight!==null&&v.blockHeight!==0){if(!Number.isSafeInteger(v.blockHeight)||(v.blockHeight as number)<0)throw new Error('Invalid block height');out.blockHeight=v.blockHeight as number}
 if(v.blockHash!==undefined&&v.blockHash!==null&&v.blockHash!==''){if(typeof v.blockHash!=='string'||!HASH.test(v.blockHash))throw new Error('Invalid block hash');out.blockHash=v.blockHash}
 if(v.merklePath!==undefined&&v.merklePath!==null&&v.merklePath!==''){if(typeof v.merklePath!=='string'||v.merklePath.length>256*1024||!HEX.test(v.merklePath))throw new Error('Invalid mining proof');out.merklePath=v.merklePath}
 if(v.competingTxs!==undefined&&v.competingTxs!==null){if(!Array.isArray(v.competingTxs)||v.competingTxs.length>256||!v.competingTxs.every(x=>typeof x==='string'&&HASH.test(x)))throw new Error('Invalid competing transaction list');out.competingTxs=[...new Set(v.competingTxs as string[])]}
 return out
}
export function parsePolicy(value:unknown):ArcPolicy{
 const v=object(object(value).policy),f=object(v.miningFee)
 const p={maxTxBytes:v.maxtxsizepolicy,feeSatoshis:f.satoshis,feeBytes:f.bytes} as ArcPolicy
 for(const n of [p.maxTxBytes,p.feeBytes])if(!Number.isSafeInteger(n)||n<=0)throw new Error('Invalid provider policy')
 if(!Number.isSafeInteger(p.feeSatoshis)||p.feeSatoshis<0)throw new Error('Invalid provider policy')
 return p
}
export function checkPolicy(review:{rawBytes:number;fee:number},policy:ArcPolicy):number{
 const p=parsePolicy({policy:{maxtxsizepolicy:policy.maxTxBytes,miningFee:{satoshis:policy.feeSatoshis,bytes:policy.feeBytes}}})
 if(!Number.isSafeInteger(review.rawBytes)||review.rawBytes<1||review.rawBytes>p.maxTxBytes)throw new Error('Transaction exceeds provider size policy')
 if(!Number.isSafeInteger(review.fee)||review.fee<0)throw new Error('Invalid transaction fee')
 const minimum=(BigInt(review.rawBytes)*BigInt(p.feeSatoshis)+BigInt(p.feeBytes)-1n)/BigInt(p.feeBytes)
 if(BigInt(review.fee)<minimum)throw new Error('Existing fee is below provider policy; no transaction was changed')
 return Number(minimum)
}
async function request(path:string,signal:AbortSignal,body?:string):Promise<{status:number;value:unknown}>{
 signal.throwIfAborted()
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason)
 signal.addEventListener('abort',abort,{once:true})
 const timer=setTimeout(()=>controller.abort(new Error('ARC request timeout; outcome may be unknown')),30000)
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
 // Race body reads too: a transport which ignores abort must not hang the UI.
 let rejectAbort:(reason:unknown)=>void=()=>{}
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject})
 const onAbort=()=>{rejectAbort(controller.signal.reason);void reader?.cancel().catch(()=>{})}
 controller.signal.addEventListener('abort',onAbort,{once:true})
 try{
  return await Promise.race([aborted,(async()=>{
   const response=await fetch(ARC_TESTNET+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'text/plain'},body}),credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal})
   controller.signal.throwIfAborted()
   if(Number(response.headers.get('content-length'))>MAX_RESPONSE)throw new Error('ARC response exceeds 4 MiB limit')
   if(!response.body)throw new Error('Empty ARC response')
   reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0
   for(;;){const part=await reader.read();controller.signal.throwIfAborted();if(part.done)break;size+=part.value.length;if(size>MAX_RESPONSE)throw new Error('ARC response exceeds 4 MiB limit');chunks.push(part.value)}
   if(response.status===404&&body===undefined)return {status:404,value:undefined}
   if(!response.ok)throw new Error(`ARC HTTP ${response.status}; check access or transaction status before retrying`)
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
   return {status:response.status,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown}
  })()])
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);void reader?.cancel().catch(()=>{})}
}
export async function fetchPolicy(signal:AbortSignal):Promise<ArcPolicy>{return parsePolicy((await request('/policy',signal)).value)}
export async function fetchStatus(id:string,signal:AbortSignal):Promise<ArcObservation|undefined>{txid(id);const r=await request(`/tx/${id}`,signal);return r.status===404?undefined:parseObservation(r.value,id)}
export async function postTransfer(efHex:string,id:string,signal:AbortSignal):Promise<ArcObservation>{
 txid(id);if(typeof efHex!=='string'||efHex.length>8*1024*1024||!HEX.test(efHex))throw new Error('Invalid extended transaction bytes')
 return parseObservation((await request('/tx',signal,efHex)).value,id)
}
