import {expect,it} from 'vitest'
import {handoffFixture} from './helpers/handoff-fixture.ts'
import {validateReceivedArchive,archiveIdentity} from '../src/handoff/archive.ts'
import {newSettlement} from '../src/handoff/settlement.ts'

it('binds archives to the signed recipient and preserves historical origin without a saved verification verdict',async()=>{
 const f=await handoffFixture(false,'http://localhost:5175')
 const archive=await validateReceivedArchive({ticket:f.ticket},f.ticket.holder)
 expect(archive.ticket.origin).toBe('http://localhost:5175')
 expect(archive).not.toHaveProperty('verification')
 expect(archive).not.toHaveProperty('wallet')
 await expect(validateReceivedArchive({ticket:f.ticket},f.source.holder)).rejects.toThrow(/recipient/i)
})
it('rejects altered recipient signatures and ticket transaction evidence',async()=>{
 const f=await handoffFixture()
 await expect(validateReceivedArchive({ticket:{...f.ticket,holder:f.source.holder}},f.source.holder)).rejects.toThrow()
 await expect(validateReceivedArchive({ticket:{...f.ticket,pkg:{...f.ticket.pkg,atomicBeefBase64:'AAAA'}}},f.ticket.holder)).rejects.toThrow()
 await expect(validateReceivedArchive({ticket:{...f.ticket,request:{...f.request,identitySignature:'AAAA'}}},f.ticket.holder)).rejects.toThrow()
})
it('separates historical wallet reports from ticket evidence and deduplicates retries',async()=>{
 const f=await handoffFixture(),settlement=newSettlement(f.ticket)
 const a=await validateReceivedArchive({ticket:f.ticket,settlement},f.ticket.holder)
 const b=await validateReceivedArchive({ticket:{...f.ticket,savedAt:new Date(Date.now()+1000).toISOString()},settlement},f.ticket.holder)
 expect(archiveIdentity(a)).toBe(archiveIdentity(b))
 expect(a.settlement?.import).toBeUndefined()
 expect(a.settlement?.wallet).toBeUndefined()
 await expect(validateReceivedArchive({ticket:f.ticket,settlement:{...settlement,ticket:f.source}},f.ticket.holder)).rejects.toThrow()
})

import {restoreReceivedArchive,synchroniseReceivedTickets,type SyncIO} from '../src/handoff/sync.ts'
import type {RecordStore} from '../src/handoff/types.ts'
function memory<T extends {id:string;revision:number}>():RecordStore<T>{
 const values=new Map<string,T>()
 return {load:async id=>values.get(id),list:async()=>[...values.values()],save:async(next,expected)=>{expect(values.get(next.id)?.revision).toBe(expected);values.set(next.id,structuredClone(next))}}
}
const io=():SyncIO=>({recipients:memory(),settlements:memory(),check:()=>{},request:async()=>{throw Error('Network unavailable')}})
it('restores an account archive into offline stores, with historical reports and no inferred wallet success',async()=>{
 const f=await handoffFixture(),local=io(),archive=await validateReceivedArchive({ticket:f.ticket},f.ticket.holder)
 await restoreReceivedArchive(archive,f.ticket.holder,local)
 expect((await local.recipients.list())[0].ticket).toEqual(f.ticket)
 const restored=(await local.settlements.list())[0]
 expect(restored.import).toBeUndefined();expect(restored.wallet).toBeUndefined()
 const at=new Date().toISOString(),settlement={...newSettlement(f.ticket),import:{id:'import-1',startedAt:at,finishedAt:at,outcome:'complete' as const},wallet:{state:'present' as const,checkedAt:at,reason:'Matched exact output'}}
 await restoreReceivedArchive({ticket:f.ticket,settlement},f.ticket.holder,local)
 const updated=(await local.settlements.list())[0]
 expect(updated.import?.outcome).toBe('complete');expect(updated.wallet?.reason).toMatch(/Reported on another device/)
})
it('retains local evidence after a sync outage and retries the same archive on reconnect',async()=>{
 const f=await handoffFixture(),local=io();await restoreReceivedArchive({ticket:f.ticket},f.ticket.holder,local)
 await expect(synchroniseReceivedTickets(f.ticket.holder,new AbortController().signal,local)).rejects.toThrow('Network unavailable')
 expect(await local.recipients.list()).toHaveLength(1)
 const sent:string[]=[]
 local.request=(async(path:string,init?:RequestInit)=>{
  if(init?.method==='POST'){const archive=await validateReceivedArchive(JSON.parse(init.body as string),f.ticket.holder);const id=archiveIdentity(archive);sent.push(id);return {id}}
  expect(path).toBe('/api/tickets/received?offset=0');return {tickets:[],nextOffset:null}
 }) as SyncIO['request']
 await synchroniseReceivedTickets(f.ticket.holder,new AbortController().signal,local)
 await synchroniseReceivedTickets(f.ticket.holder,new AbortController().signal,local)
 expect(sent).toHaveLength(2);expect(sent[0]).toBe(sent[1])
})
it('does not upload another account or overwrite a stronger local mining envelope with a stale snapshot',async()=>{
 const f=await handoffFixture(true),local=io();await restoreReceivedArchive({ticket:f.ticket},f.ticket.holder,local)
 const {Utils}=await import('@bsv/sdk'),tx=f.tx;tx.merklePath=undefined
 const stale={...f.ticket,pkg:{...f.ticket.pkg,atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}}
 await restoreReceivedArchive({ticket:stale},f.ticket.holder,local)
 expect((await local.settlements.list())[0].ticket.pkg.atomicBeefBase64).toBe(f.ticket.pkg.atomicBeefBase64)
 let posts=0
 local.request=(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST')posts++;return {tickets:[],nextOffset:null}}) as SyncIO['request']
 await synchroniseReceivedTickets(f.source.holder,new AbortController().signal,local);expect(posts).toBe(0)
})
it('stops restoration when the active account changes and rejects a mismatched archive response',async()=>{
 const f=await handoffFixture(),local=io(),archive={ticket:f.ticket},id=archiveIdentity(archive)
 local.request=(async(path:string)=>path.includes('?')?{tickets:[{id}],nextOffset:null}:{ticket:{...f.ticket,savedAt:'invalid'}}) as SyncIO['request']
 await expect(synchroniseReceivedTickets(f.ticket.holder,new AbortController().signal,local)).rejects.toThrow()
 expect(await local.recipients.list()).toHaveLength(0)
 local.check=()=>{throw Error('Account changed')}
 await expect(restoreReceivedArchive(archive,f.ticket.holder,local)).rejects.toThrow('Account changed')
 expect(await local.recipients.list()).toHaveLength(0)
})
