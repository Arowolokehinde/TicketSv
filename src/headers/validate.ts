import { Hash, Utils } from '@bsv/sdk'
import { CHECKPOINT, validHeaderHeight } from './checkpoint.ts'
export type Provider = 'whatsonchain' | 'chaintracks'
export type HeaderRecord = Readonly<{ height: number; hash: string; hex: string }>
export type HeaderSnapshot = Readonly<{ version: 1; network: 'testnet'; id: string; syncedAt: string; headers: readonly HeaderRecord[]; source?: 'ticketsv-cache' }>
const POW_LIMIT = 0xffffn << 208n
const hashPattern = /^[0-9a-f]{64}$/
function reject(message: string): never { throw new Error(message) }
export function compactTarget(bits: number): bigint {
 if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff) reject('Invalid compact target')
 const size=bits>>>24, word=bits&0x7fffff
 if ((bits&0x800000)!==0 || word===0 || size>34) reject('Invalid compact target')
 const target=size<=3 ? BigInt(word)>>BigInt(8*(3-size)) : BigInt(word)<<BigInt(8*(size-3))
 if (target<=0n || target>POW_LIMIT) reject('Compact target outside testnet bounds')
 return target
}
export function validateHeader(hex: string): { hash: string; previousHash: string; merkleRoot: string } {
 if (typeof hex!=='string' || !/^[0-9a-f]{160}$/.test(hex)) reject('Header must contain exactly 80 bytes')
 const bytes=Utils.toArray(hex,'hex'), view=new DataView(Uint8Array.from(bytes).buffer)
 const hash=Utils.toHex(Hash.hash256(bytes).reverse())
 if (BigInt('0x'+hash)>compactTarget(view.getUint32(72,true))) reject('Header proof of work failed')
 return {hash,previousHash:Utils.toHex(bytes.slice(4,36).reverse()),merkleRoot:Utils.toHex(bytes.slice(36,68).reverse())}
}
export function parseProviderHeader(value: unknown, provider: Provider, height: number): HeaderRecord {
 if (!value || typeof value!=='object') reject('Invalid provider header')
 const v=value as Record<string,unknown>
 const previous=provider==='whatsonchain'?v.previousblockhash:v.previousHash
 const root=provider==='whatsonchain'?v.merkleroot:v.merkleRoot
 const bits=provider==='whatsonchain' && typeof v.bits==='string' && /^[0-9a-f]{8}$/.test(v.bits) ? parseInt(v.bits,16) : v.bits
 if (v.height!==height || !Number.isSafeInteger(height) || height<0 || typeof v.hash!=='string' || !hashPattern.test(v.hash) || typeof previous!=='string' || !hashPattern.test(previous) || typeof root!=='string' || !hashPattern.test(root)) reject('Header height/hash fields do not match')
 if (typeof v.version!=='number' || !Number.isInteger(v.version) || v.version < -2147483648 || v.version>0xffffffff) reject('Invalid header version')
 for (const n of [v.time,bits,v.nonce]) if(typeof n!=='number' || !Number.isInteger(n) || n<0 || n>0xffffffff) reject('Invalid header integer')
 const bytes=new Uint8Array(80), view=new DataView(bytes.buffer)
 view.setUint32(0,v.version,true)
 bytes.set(Utils.toArray(previous,'hex').reverse(),4); bytes.set(Utils.toArray(root,'hex').reverse(),36)
 view.setUint32(68,v.time as number,true); view.setUint32(72,bits as number,true); view.setUint32(76,v.nonce as number,true)
 const hex=Utils.toHex([...bytes]); if(validateHeader(hex).hash!==v.hash) reject('Header hash does not match its bytes')
 return Object.freeze({height,hash:v.hash,hex})
}
// Only objects created here are trusted for reuse. A forged ID or frozen caller
// object cannot bypass validation; deserialized data is checked on first use.
const validated = new WeakSet<HeaderSnapshot>()
const parents = new WeakMap<HeaderSnapshot, {id:string;length:number}>()
export function snapshotParent(snapshot:HeaderSnapshot){return parents.get(snapshot)}
const parsedRecords = new WeakMap<HeaderRecord, ReturnType<typeof validateHeader>>()
export function checkedHeader(record: HeaderRecord): ReturnType<typeof validateHeader> {
 const cached=parsedRecords.get(record)
 if(cached)return cached
 const parsed=validateHeader(record.hex)
 if(parsed.hash!==record.hash)reject('Stored header hash mismatch')
 return parsed
}
function snapshotFrom(headers: readonly HeaderRecord[], syncedAt: string, source?: HeaderSnapshot['source']): HeaderSnapshot {
 if(source !== undefined && source !== 'ticketsv-cache') reject('Invalid header snapshot source')
 if(typeof syncedAt!=='string' || !Number.isFinite(Date.parse(syncedAt)))reject('Invalid header snapshot')
 // Keep the original SHA256(concatenated header bytes) identity for all saved
 // tickets and verification contexts. PoW and linkage are checked only on append.
 const id=Utils.toHex(Hash.sha256(Utils.toArray(headers.map(h=>h.hex).join(''),'hex')))
 const snapshot=Object.freeze({version:1 as const,network:'testnet' as const,id,syncedAt,headers:Object.freeze(headers),...(source?{source}:{})})
 validated.add(snapshot)
 return snapshot
}
export function appendSnapshot(previous: HeaderSnapshot | undefined, records: readonly HeaderRecord[], syncedAt=new Date().toISOString(), source=previous?.source): HeaderSnapshot {
 const old=previous?validateSnapshot(previous):undefined
 if(!Array.isArray(records) || !old && !records.length)reject('Invalid header snapshot')
 const headers=[...(old?.headers??[])]
 for(const r of records){
  if(!r || !validHeaderHeight(r.height) || r.height!==CHECKPOINT.height+headers.length)reject('Header checkpoint/range mismatch')
  const parsed=checkedHeader(r)
  if(!headers.length && r.hash!==CHECKPOINT.hash)reject('Checkpoint conflict — explicit rebootstrap required')
  if(headers.length && parsed.previousHash!==headers.at(-1)!.hash)reject('Header linkage failed')
  const frozen=Object.freeze({height:r.height,hash:r.hash,hex:r.hex})
  parsedRecords.set(frozen,Object.freeze(parsed));headers.push(frozen)
 }
 const snapshot=snapshotFrom(headers,syncedAt,source)
 if(old)parents.set(snapshot,Object.freeze({id:old.id,length:old.headers.length}))
 return snapshot
}
export function makeSnapshot(records: readonly HeaderRecord[], syncedAt=new Date().toISOString(), source?: HeaderSnapshot['source']): HeaderSnapshot {
 return appendSnapshot(undefined,records,syncedAt,source)
}
export function validateSnapshot(value: unknown, previous?: HeaderSnapshot): HeaderSnapshot {
 if(!value || typeof value!=='object')reject('Invalid stored header snapshot')
 const v=value as HeaderSnapshot
 if(validated.has(v))return v
 if(v.version!==1 || v.network!=='testnet')reject('Stored snapshot network/version mismatch')
 const prefix=previous?validateSnapshot(previous):undefined
 const matching=prefix && v.source===prefix.source && Array.isArray(v.headers) && v.headers.length>=prefix.headers.length && prefix.headers.every((r,i)=>{
  const h=v.headers[i];return h && h.height===r.height && h.hash===r.hash && h.hex===r.hex
 })
 if(matching && v.headers.length===prefix.headers.length && v.id===prefix.id && v.syncedAt===prefix.syncedAt && v.source===prefix.source)return prefix
 const checked=matching?appendSnapshot(prefix,v.headers.slice(prefix.headers.length),v.syncedAt,v.source):makeSnapshot(v.headers,v.syncedAt,v.source)
 if(v.id!==checked.id)reject('Stored snapshot identifier mismatch')
 return checked
}
