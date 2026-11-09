import {api} from '../auth/api.ts'
import {archiveIdentity,archiveBinding,validateReceivedArchive,type ReceivedArchive} from './archive.ts'
import {recipientKey,recipientStore,readRecipient} from './store.ts'
import {settlementStore,newSettlement,readSettlement} from './settlement.ts'
import type {HandoffSettlement} from './settlement.ts'
import type {RecipientRecord,RecordStore} from './types.ts'
import {Transaction} from '@bsv/sdk'
import {fromBase64} from '../tickets/codec.ts'

export type SyncIO={recipients:RecordStore<RecipientRecord>;settlements:RecordStore<HandoffSettlement>;request:typeof api;check:()=>void}
const defaults:SyncIO={recipients:recipientStore,settlements:settlementStore,request:api,check:()=>{}}
const minedEnvelope=(a:ReceivedArchive)=>!!Transaction.fromAtomicBEEF(fromBase64(a.ticket.pkg.atomicBeefBase64)).merklePath
export async function restoreReceivedArchive(value:unknown,owner:string,io:SyncIO=defaults){
 const archive=await validateReceivedArchive(value,owner);io.check()
 const ticket=archive.ticket,key=recipientKey(ticket.request!),old=await io.recipients.load(key);io.check()
 if(old?.ticket&&archiveBinding(old.ticket)!==archiveBinding(ticket))throw Error('A different transfer already uses this receiving request. Existing local evidence was retained.')
 const current=await io.settlements.load(newSettlement(ticket).id);io.check()
 // Never replace a local mined envelope with an older unmined archive.
 const chosen=old?.ticket&&minedEnvelope({ticket:old.ticket})&&!minedEnvelope(archive)?old.ticket:ticket
 if(!old)await io.recipients.save(readRecipient({kind:'ticketsv-handoff-recipient',version:1,id:key,revision:0,request:chosen.request,ticket:chosen}),undefined)
 else if(JSON.stringify(old.ticket)!==JSON.stringify(chosen))await io.recipients.save(readRecipient({...old,ticket:chosen,revision:old.revision+1},old),old.revision)
 io.check()
 if(!current){
  const reported=archive.settlement
  const restored=readSettlement({...newSettlement(chosen),...(reported?{submit:reported.submit,import:reported.import,status:reported.status,notFoundAt:reported.notFoundAt,wallet:reported.wallet?{...reported.wallet,reason:reported.wallet.reason.startsWith('Reported on another device: ')?reported.wallet.reason:'Reported on another device: '+reported.wallet.reason.slice(0,900)}:undefined}:{})})
  await io.settlements.save(restored,undefined)
 }
 else {
  const chosenTicket=minedEnvelope({ticket:current.ticket})&&!minedEnvelope({ticket:chosen})?current.ticket:chosen
  const remote=archive.settlement
  const mergeAttempt=(local:HandoffSettlement['import'],reported:HandoffSettlement['import'])=>{
   if(!local)return reported
   if(!reported||local.id!==reported.id||local.outcome!=='pending')return local
   return reported
  }
  const status=remote?.status&&['MINED','IMMUTABLE'].includes(remote.status.txStatus)?remote.status:current.status
  const wallet=current.wallet??(remote?.wallet?{...remote.wallet,reason:remote.wallet.reason.startsWith('Reported on another device: ')?remote.wallet.reason:'Reported on another device: '+remote.wallet.reason.slice(0,900)}:undefined)
  const candidate={...current,ticket:chosenTicket,submit:mergeAttempt(current.submit,remote?.submit),import:mergeAttempt(current.import,remote?.import),wallet,status}
  if(archiveIdentity({ticket:candidate.ticket,settlement:candidate})!==archiveIdentity({ticket:current.ticket,settlement:current}))await io.settlements.save(readSettlement({...candidate,revision:current.revision+1},current),current.revision)
 }
 // A recovered verdict is never trusted, and sync never invokes a wallet.
 return archive
}
export async function synchroniseReceivedTickets(owner:string,signal:AbortSignal,io:SyncIO=defaults){
 const check=()=>{signal.throwIfAborted();io.check()};check()
 const [recipients,settlements]=await Promise.all([io.recipients.list(),io.settlements.list()]);check()
 const local=new Map<string,ReceivedArchive>()
 for(const r of recipients)if(r.ticket?.holder===owner&&r.ticket.request)local.set(newSettlement(r.ticket).id,{ticket:r.ticket})
 for(const r of settlements)if(r.ticket.holder===owner&&r.ticket.request)local.set(r.id,{ticket:r.ticket,settlement:r})
 // Discover immutable IDs first so unchanged evidence is not uploaded again.
 const entries:{id:string}[]=[],seen=new Set<string>()
 let offset:number|null=0
 while(offset!==null){
  const page:{tickets:{id:string}[];nextOffset:number|null}=await io.request(`/api/tickets/received?offset=${offset}`,{signal,headers:{'x-ticketsv-identity':owner}});check()
  if(!Array.isArray(page.tickets)||page.tickets.length>25||page.nextOffset!==null&&(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset||page.nextOffset>10000))throw Error('Invalid account archive page.')
  for(const row of page.tickets){
   if(!/^[0-9a-f]{64}$/.test(row.id)||seen.has(row.id))throw Error('Invalid or repeated account archive entry.')
   seen.add(row.id);entries.push(row)
  }
  offset=page.nextOffset
 }
 let uploaded=0
 const localIDs=new Set<string>()
 // A failure leaves every unsynchronised local record intact for the next retry.
 for(const value of local.values()){
  const archive=await validateReceivedArchive(value,owner);check()
  const id=archiveIdentity(archive);localIDs.add(id)
  if(seen.has(id))continue
  const response=await io.request<{id:string}>('/api/tickets/received',{method:'POST',body:JSON.stringify(archive),signal,headers:{'x-ticketsv-identity':owner}});check()
  if(response.id!==id)throw Error('Account archive acknowledgement did not match the saved evidence.')
  uploaded++
 }
 const restoredOutputs=new Set<string>()
 for(const row of entries){
  if(localIDs.has(row.id))continue
  const value=await io.request<ReceivedArchive>(`/api/tickets/received/${row.id}`,{signal,headers:{'x-ticketsv-identity':owner}},4*1024*1024);check()
  const checked=await validateReceivedArchive(value,owner);check()
  if(archiveIdentity(checked)!==row.id)throw Error('Account archive integrity check failed.')
  await restoreReceivedArchive(checked,owner,{...io,check});check()
  restoredOutputs.add(newSettlement(checked.ticket).id)
 }
 const restored=restoredOutputs.size
 return {uploaded,restored}
}
export async function signedInSync(signal:AbortSignal){
 const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal})
 if(response.status===401)throw Error('Sign in on Dashboard to synchronise this device. Offline copies are retained.')
 if(!response.ok)throw Error('Account synchronisation is unavailable. Offline copies are retained.')
 const session=await response.json() as {identityKey:string;network:string}
 if(session.network!=='testnet'||typeof session.identityKey!=='string')throw Error('Invalid account session.')
 return synchroniseReceivedTickets(session.identityKey,signal)
}
