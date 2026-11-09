import {createHeaderResourceCache} from './header-resource-cache.ts'
import {setTimeout as delay} from 'node:timers/promises'
import { boundedBytes, checkHeaderRange, decodeHeaderBatch } from '../src/headers/batch.ts'
import { parseProviderHeader, validateHeader, type HeaderRecord } from '../src/headers/validate.ts'
const WOC = 'https://api.whatsonchain.com/v1/bsv/test/block/headers/'
const CT = 'https://chaintracks-testnet-us-1.bsvb.tech/v2/'
const resources=new WeakMap<typeof fetch,ReturnType<typeof createHeaderResourceCache>>()
export class HeaderConflict extends Error {}
export type HeaderResolution = {height:number; rejectedHash:string; acceptedHash:string; childHash:string}
export async function collectHeaderRange(start: number, count: number, signal: AbortSignal, get: typeof fetch = fetch, onResolution?:(resolution:HeaderResolution)=>void): Promise<HeaderRecord[]> {
 checkHeaderRange(start, count); signal.throwIfAborted()
 const cache=resources.get(get)??createHeaderResourceCache();resources.set(get,cache)
 const operation = new AbortController()
 const timeout = AbortSignal.any([signal, operation.signal, AbortSignal.timeout(20_000)])
 const pending: Promise<unknown>[] = []
 try {
 const bytes = (url: string, limit: number) => {
  const request = (async () => {
  timeout.throwIfAborted()
  const ttl=url===CT+'network'?300_000:url===WOC+'resources'?30_000:url.startsWith(WOC)&&url.endsWith('_headers.bin')?300_000:0
  return cache.read(url,ttl,timeout,async()=>boundedBytes(await get(url, { signal: timeout, redirect: 'error', credentials: 'omit', cache: 'no-store' }), limit, timeout))
  })()
  pending.push(request); return request
 }
 const json = async (url: string, limit: number) => JSON.parse(new TextDecoder().decode(await bytes(url, limit)))
 const [network, index] = await Promise.all([json(CT + 'network', 1024), json(WOC + 'resources', 100_000)])
 if (network?.status !== 'success' || network?.value !== 'test') throw new HeaderConflict('Chaintracks network is not testnet.')
 if (!Array.isArray(index?.files) || index.files.length > 3000) throw Error('Invalid header resource index.')
 const files: { url: string; start: number; end: number }[] = []; let latest = false
 for (const url of index.files) {
  if (typeof url !== 'string' || !url.startsWith(WOC)) throw Error('Untrusted header resource URL.')
  const name = url.slice(WOC.length)
  if (name === 'latest') { if (latest) throw Error('Duplicate latest resource.'); latest = true; continue }
  const match = /^(\d+)_(\d+)_headers\.bin$/.exec(name)
  if (!match) throw Error('Invalid header resource filename.')
  const from = Number(match[1]), to = Number(match[2])
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to - from > 10000) throw Error('Invalid header resource range.')
  files.push({ url, start: from, end: to })
 }
 files.sort((a,b)=>a.start-b.start)
 for (let i=1;i<files.length;i++) if (files[i].start<=files[i-1].end) throw Error('Overlapping header resources.')
 if (latest && files.length) files.push({ url: WOC + 'latest', start: files.at(-1)!.end + 1, end: files.at(-1)!.end + 25000 })
 const woc = async () => {
  const output = new Uint8Array(count * 80); let next = start
  for (const file of files) {
   if (file.end < next || file.start > start + count - 1) continue
   if (file.start > next) throw Error('Required header resource missing.')
   const raw = await bytes(file.url, 2_000_000)
   if (raw.length % 80 || (!file.url.endsWith('/latest') && raw.length !== (file.end-file.start+1)*80)) throw Error('Header resource length mismatch.')
   const available = Math.min(file.start + raw.length/80 - 1, start + count - 1)
   if (available < next) break
   output.set(raw.subarray((next-file.start)*80, (available-file.start+1)*80), (next-start)*80)
   next = available + 1
   if (next === start + count) return output
  }
  // The latest binary resource can lag the individual-header endpoint. Only
  // fill a small recent tail; bulk history must still use bounded binary files.
  if (!latest || !files.length || next < files.at(-1)!.start || start + count - next > 32) throw Error('Required headers have not reached the source files yet.')
  for (; next < start + count; next++) {
   timeout.throwIfAborted()
   const value = await json(`https://api.whatsonchain.com/v1/bsv/test/block/${next}/header`, 16384)
   let header: HeaderRecord
   try { header = parseProviderHeader(value, 'whatsonchain', next) }
   catch (e) { throw new HeaderConflict((e as Error).message) }
   output.set(Uint8Array.from(Buffer.from(header.hex, 'hex')), (next-start)*80)
   if (next + 1 < start + count) await delay(350, undefined, {signal:timeout})
  }
  return output
 }
 const [a,b] = await Promise.all([bytes(`${CT}headers?height=${start}&count=${count}`, count*80), woc()])
 timeout.throwIfAborted()
 try {
  const expected=decodeHeaderBatch(b,start,count)
  if(a.length!==b.length)throw Error('Header source range length disagreement.')
  const differs=(i:number)=>a.subarray(i*80,(i+1)*80).some((value,j)=>value!==b[i*80+j])
  const mismatches=expected.flatMap((_,i)=>differs(i)?[i]:[])
  // A common descendant is mandatory: do not resolve a disputed tip by simply
  // asking whether the other provider also knows a candidate block.
  if(mismatches.length>4||mismatches.includes(count-1))throw Error('Header sources disagree without a bounded common descendant.')
  const resolutions:HeaderResolution[]=[]
  for(const i of mismatches.reverse()){
   const hex=(bytes:Uint8Array)=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('')
   const original=validateHeader(hex(a.subarray(i*80,(i+1)*80)))
   const child=validateHeader(hex(a.subarray((i+1)*80,(i+2)*80)))
   if(child.previousHash!==expected[i].hash||differs(i+1))throw Error('Header disagreement has no agreed child.')
   const found=await json(`${CT}header/hash/${child.previousHash}`,16384)
   timeout.throwIfAborted()
   if(found?.status!=='success')throw Error('Linked header lookup failed.')
   const resolved=parseProviderHeader(found.value,'chaintracks',start+i)
   if(resolved.hash!==child.previousHash||resolved.hex!==expected[i].hex)throw Error('Linked header sources still disagree.')
   a.set(b.subarray(i*80,(i+1)*80),i*80)
   resolutions.push({height:start+i,rejectedHash:original.hash,acceptedHash:resolved.hash,childHash:child.hash})
  }
  const checked=decodeHeaderBatch(a,start,count)
  for(const resolution of resolutions)onResolution?.(resolution)
  return checked
 } catch(e) {
  timeout.throwIfAborted()
  throw new HeaderConflict((e as Error).message)
 }
 } catch(error) { cache.clear();throw error } finally { operation.abort(); await Promise.allSettled(pending) }
}
