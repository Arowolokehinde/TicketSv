import { describe, it, expect, vi } from 'vitest'
import woc0 from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import woc1 from './fixtures/headers/woc-1762325.json' with { type: 'json' }
import ct1 from './fixtures/headers/chaintracks-1762325.json' with { type: 'json' }
import { parseProviderHeader, validateHeader, makeSnapshot, validateSnapshot, compactTarget, appendSnapshot, checkedHeader } from '../src/headers/validate.ts'
import { createLocalTracker } from '../src/headers/tracker.ts'

export const records = () => [parseProviderHeader(woc0, 'whatsonchain',1762324),parseProviderHeader(woc1,'whatsonchain',1762325)]
describe('checkpoint-bound headers', () => {
 it('serializes two independent providers identically and verifies real proof of work', () => {
  const [a,b] = records()
  expect(b).toEqual(parseProviderHeader(ct1,'chaintracks',1762325))
  expect(validateHeader(b.hex).hash).toBe(woc1.hash)
  expect(validateHeader(b.hex).previousHash).toBe(a.hash)
  expect(validateHeader(b.hex).merkleRoot).toBe(woc1.merkleroot)
  expect(makeSnapshot([a,b]).headers).toHaveLength(2)
 })
 it.each([0,0x1d80ffff,0x2300ffff,0x1e00ffff])('rejects invalid target %s', bits => expect(()=>compactTarget(bits)).toThrow())
 it('rejects short headers, invalid PoW, wrong claimed height/hash and linkage', () => {
  const [a,b] = records()
  expect(()=>validateHeader(b.hex.slice(2))).toThrow('Header must contain exactly 80 bytes')
  expect(()=>validateHeader(b.hex.slice(0,-8)+'00000000')).toThrow(/work/i)
  expect(()=>parseProviderHeader({...woc1,hash:'00'.repeat(32)},'whatsonchain',1762325)).toThrow('Header hash does not match its bytes')
  expect(()=>parseProviderHeader(woc1,'whatsonchain',1762324)).toThrow('Header height/hash fields do not match')
  expect(()=>makeSnapshot([a,{...b,height:1762326}])).toThrow('Header checkpoint/range mismatch')
  expect(()=>makeSnapshot([a,{...a,height:1762325}])).toThrow(/link/i)
  expect(()=>makeSnapshot([b])).toThrow(/checkpoint/i)
 })
 it('revalidates stored snapshots and refuses a forged identifier', () => {
  const s=makeSnapshot(records())
  expect(validateSnapshot(JSON.parse(JSON.stringify(s))).id).toBe(s.id)
  expect(()=>validateSnapshot({...s,id:'fake'})).toThrow('Stored snapshot identifier mismatch')
  expect(()=>validateSnapshot({...s,network:'mainnet'})).toThrow('Stored snapshot network/version mismatch')
 })
 it('compares the actual local root, freezes its snapshot and never fetches', async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
  try {
   const s=makeSnapshot(records()); const t=createLocalTracker(s)
   await expect(t.isValidRootForHeight(woc1.merkleroot,1762325)).resolves.toBe(true)
   await expect(t.isValidRootForHeight('00'.repeat(32),1762325)).resolves.toBe(false)
   await expect(t.isValidRootForHeight(woc1.merkleroot,1762326)).rejects.toThrow('HEADER_MISSING')
   expect(()=>{(s.headers as unknown[]).pop()}).toThrow('Cannot delete property \'1\' of [object Array]')
   await expect(t.currentHeight()).resolves.toBe(1762325)
   expect(fetch).not.toHaveBeenCalled()
  } finally {fetch.mockRestore()}
 })
})

it('reuses only immutable validated snapshots and appends without changing the legacy identifier',()=>{
 const [a,b]=records(),prefix=makeSnapshot([a]),next=appendSnapshot(prefix,[b])
 expect(validateSnapshot(prefix)).toBe(prefix)
 expect(next.headers[0]).toBe(prefix.headers[0])
 expect(next.id).toBe(makeSnapshot([a,b]).id)
 expect(next.headers).toEqual([a,b])
 expect(()=>appendSnapshot(prefix,[{...b,hash:'00'.repeat(32)}])).toThrow('Stored header hash mismatch')
 expect(()=>appendSnapshot(prefix,[{...a,height:b.height}])).toThrow(/link/i)
 expect(()=>validateSnapshot({...prefix,headers:[{...a,hex:'00'.repeat(80)}]})).toThrow('Invalid compact target')
 expect(()=>appendSnapshot(prefix,[{...b,height:b.height+1}])).toThrow('Header checkpoint/range mismatch')
})

it('reuses a checked immutable prefix across backend deserialization without trusting an ID alone',()=>{
 const [a,b]=records(),prefix=makeSnapshot([a]),full=makeSnapshot([a,b])
 const raw=JSON.parse(JSON.stringify(full))
 const checked=validateSnapshot(raw,prefix)
 expect(checked.headers[0]).toBe(prefix.headers[0])
 expect(checked.id).toBe(full.id)
 expect(()=>validateSnapshot({...raw,headers:[{...a,hex:'00'.repeat(80)},b]},prefix)).toThrow('Invalid compact target')
 expect(()=>validateSnapshot({...raw,id:'fake'},prefix)).toThrow('Stored snapshot identifier mismatch')
})

it('keeps cached header roots and linkage immutable for local verification',async()=>{
 const snapshot=makeSnapshot(records()),parsed=checkedHeader(snapshot.headers[1])
 expect(()=>{parsed.merkleRoot='00'.repeat(32)}).toThrow('Cannot assign to read only property \'merkleRoot\' of object \'#<Object>\'')
 expect(()=>{parsed.previousHash='00'.repeat(32)}).toThrow('Cannot assign to read only property \'previousHash\' of object \'#<Object>\'')
 expect(await createLocalTracker(snapshot).isValidRootForHeight(woc1.merkleroot,1762325)).toBe(true)
})
