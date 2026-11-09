import {Transaction,type WalletInterface} from '@bsv/sdk'
import type {HandoffTicket,Attempt,RecordStore} from './types.ts'
import {readHandoffTicket,verifyHandoffTicket} from './evidence.ts'
import {createStore} from './store.ts'
import {fromBase64} from '../tickets/codec.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {fetchPolicy,fetchStatus,postTransfer,checkPolicy,parseObservation} from '../settlement/arc.ts'
import {minedCandidate,verifyMiningAnchor,transactionSummary} from '../settlement/evidence.ts'
import type {ArcObservation} from '../settlement/types.ts'
import {waitImport} from '../wallet/mined-import.ts'
import {prepareHandoffHeaders,requiredHeaderHeight} from './headers.ts'
import type {HeaderSyncProgress} from '../headers/sync.ts'
import type {Verification} from '../tickets/types.ts'
import {requireMinedEvidence} from '../offline/attendee-evidence.ts'

export type WalletObservation={state:'present'|'absent'|'inconclusive';checkedAt:string;reason:string}
export type HandoffSettlement={id:string;revision:number;version:1;ticket:HandoffTicket;submit?:Attempt;import?:Attempt;status?:ArcObservation;notFoundAt?:string;wallet?:WalletObservation}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
export function settlementKey(t:HandoffTicket){return `${t.holder}:testnet:${t.pkg.current.txid}`}
export function reopening(t:HandoffTicket){return {kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:t.trustedVenue,pkg:t.pkg,buyer:t.pkg.request}}
function attempt(a:Attempt|undefined,old?:Attempt){
 if(old&&(!a||a.id!==old.id||a.startedAt!==old.startedAt||old.outcome!=='pending'&&!same(a,old)))throw Error('An existing attempt cannot be replaced or retried.')
 if(a&&(!/^[a-z0-9-]{1,100}$/.test(a.id)||!['pending','complete','unknown'].includes(a.outcome)||!Number.isFinite(Date.parse(a.startedAt))||(a.outcome==='pending'?a.finishedAt!==undefined:!Number.isFinite(Date.parse(a.finishedAt!)))))throw Error('Invalid saved attempt.')
 return a
}
export function readSettlement(value:unknown,previous?:HandoffSettlement):HandoffSettlement{
 if(!value||typeof value!=='object')throw Error('Invalid handoff settlement record.')
 const v=value as HandoffSettlement,ticket=readHandoffTicket(v.ticket)
 if(v.version!==1||!ticket.request||v.id!==settlementKey(ticket)||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('Invalid handoff settlement context.')
 if(previous){
  if(v.id!==previous.id||v.revision!==previous.revision+1)throw Error('Settlement changed; reload it.')
  // Only a mining proof may update an already-bound transfer.
  const stripped=(t:HandoffTicket)=>({...t,savedAt:'',pkg:{...t.pkg,atomicBeefBase64:''}})
  if(!same(stripped(ticket),stripped(previous.ticket))||Transaction.fromAtomicBEEF(fromBase64(ticket.pkg.atomicBeefBase64)).toHex()!==Transaction.fromAtomicBEEF(fromBase64(previous.ticket.pkg.atomicBeefBase64)).toHex())throw Error('Signed transfer changed.')
 }
 if(v.notFoundAt!==undefined&&(typeof v.notFoundAt!=='string'||!Number.isFinite(Date.parse(v.notFoundAt))))throw Error('Invalid not-found observation date.')
 const submit=attempt(v.submit,previous?.submit),imported=attempt(v.import,previous?.import)
 const status=v.status?parseObservation({...v.status,txid:v.status.txid},ticket.pkg.current.txid):undefined
 if(status){if(!Number.isFinite(Date.parse(v.status!.observedAt)))throw Error('Invalid status date.');status.observedAt=v.status!.observedAt}
 if(v.wallet&&(!['present','absent','inconclusive'].includes(v.wallet.state)||typeof v.wallet.reason!=='string'||v.wallet.reason.length>1000||!Number.isFinite(Date.parse(v.wallet.checkedAt))))throw Error('Invalid wallet observation.')
 return {id:v.id,revision:v.revision,version:1,ticket,...(submit?{submit}:{}),...(imported?{import:imported}:{}),...(status?{status}:{}),...(v.notFoundAt?{notFoundAt:v.notFoundAt}:{}),...(v.wallet?{wallet:v.wallet}:{})}
}
export function newSettlement(ticket:HandoffTicket):HandoffSettlement{return readSettlement({id:settlementKey(ticket),revision:0,version:1,ticket})}
export const settlementStore=createStore<HandoffSettlement>('settlements',readSettlement)
async function current(r:HandoffSettlement,store:RecordStore<HandoffSettlement>){const saved=await store.load(r.id);if(!saved||!same(saved,r))throw Error('Saved transfer changed. Reload and review.');return saved}
async function write(r:HandoffSettlement,patch:Partial<HandoffSettlement>,store:RecordStore<HandoffSettlement>){const n=readSettlement({...r,...patch,revision:r.revision+1},r);await store.save(n,r.revision);if(typeof window!=='undefined')window.dispatchEvent(new Event('ticketsv-handoff-saved'));return n}
const pending=():Attempt=>({id:crypto.randomUUID(),startedAt:new Date().toISOString(),outcome:'pending'})
const finish=(a:Attempt,outcome:Attempt['outcome']):Attempt=>({...a,outcome,finishedAt:new Date().toISOString()})
async function verified(t:HandoffTicket,s:HeaderSnapshot|undefined,mined=false){const v=await verifyHandoffTicket(t,s);if(mined)requireMinedEvidence(v);else if(v.verdict!=='verified')throw Error('Verify all ticket evidence before publishing.');return v}
export async function submitHandoff(r:HandoffSettlement,snapshot:HeaderSnapshot|undefined,signal:AbortSignal,store:RecordStore<HandoffSettlement>=settlementStore,api={policy:fetchPolicy,post:postTransfer,status:fetchStatus}){
 r=readSettlement(r);if(r.submit||r.status&&r.status.txStatus!=='UNKNOWN')throw Error('Publication already attempted or observed; check status without retrying.')
 await current(r,store);await verified(r.ticket,snapshot);signal.throwIfAborted()
 const summary=transactionSummary(reopening(r.ticket));checkPolicy(summary,await api.policy(signal));signal.throwIfAborted()
 const observed=await api.status(r.ticket.pkg.current.txid,signal);signal.throwIfAborted()
 if(observed&&observed.txStatus!=='UNKNOWN')return write(r,{status:observed,notFoundAt:undefined},store)
 await current(r,store);r=await write(r,{submit:pending()},store)
 try{signal.throwIfAborted();await current(r,store);const response=await waitImport(()=>{signal.throwIfAborted();return api.post(summary.efHex,summary.txid,signal)},signal);signal.throwIfAborted();return await write(r,{submit:finish(r.submit!,'complete'),status:response,notFoundAt:undefined},store)}
 catch{ return write(r,{submit:finish(r.submit!,'unknown')},store) }
}
export async function checkHandoffStatus(r:HandoffSettlement,signal:AbortSignal,store:RecordStore<HandoffSettlement>=settlementStore){await current(r,store);const status=await fetchStatus(r.ticket.pkg.current.txid,signal);signal.throwIfAborted();return write(r,status?{status,notFoundAt:undefined}:{notFoundAt:new Date().toISOString()},store)}
export function handoffMiningCandidate(r:HandoffSettlement):HandoffTicket{if(!r.status)throw Error('Check transfer status first.');return readHandoffTicket({...r.ticket,pkg:minedCandidate(reopening(r.ticket),r.status).pkg})}
export async function saveVerifiedMining(r:HandoffSettlement,snapshot:HeaderSnapshot|undefined,store:RecordStore<HandoffSettlement>=settlementStore){
 const ticket=handoffMiningCandidate(r);if(!verifyMiningAnchor(r.status!,snapshot))throw Error('Required mining header is missing.');await verified(ticket,snapshot,true);await current(r,store);return write(r,{ticket},store)
}
export type MiningPreparation={settlement:HandoffSettlement;verification?:Verification;preparationError?:string}
type PrepareMiningHeaders=(height:number,signal:AbortSignal,onProgress?:(p:HeaderSyncProgress)=>void)=>Promise<HeaderSnapshot|undefined>
export async function verifyHandoffMining(r:HandoffSettlement,signal:AbortSignal,onProgress?:(p:HeaderSyncProgress)=>void,store:RecordStore<HandoffSettlement>=settlementStore,prepare:PrepareMiningHeaders=prepareHandoffHeaders):Promise<MiningPreparation>{
 const candidate=handoffMiningCandidate(r)
 const snapshot=await prepare(requiredHeaderHeight(candidate.pkg.current.txid,candidate.pkg.atomicBeefBase64),signal,onProgress)
 signal.throwIfAborted()
 const next=await saveVerifiedMining(r,snapshot,store)
 return {settlement:next,verification:await verifyHandoffTicket(next.ticket,snapshot)}
}
export async function checkHandoffMining(r:HandoffSettlement,signal:AbortSignal,onProgress?:(p:HeaderSyncProgress)=>void,store:RecordStore<HandoffSettlement>=settlementStore,prepare:PrepareMiningHeaders=prepareHandoffHeaders):Promise<MiningPreparation>{
 // The provider observation is durable before any fallible preparation. A retry
 // checks this same signed transfer; it never publishes or mutates a wallet.
 const checked=await checkHandoffStatus(r,signal,store)
 return prepareObservedHandoffMining(checked,signal,onProgress,store,prepare)
}
export async function prepareObservedHandoffMining(checked:HandoffSettlement,signal:AbortSignal,onProgress?:(p:HeaderSyncProgress)=>void,store:RecordStore<HandoffSettlement>=settlementStore,prepare:PrepareMiningHeaders=prepareHandoffHeaders):Promise<MiningPreparation>{
 if(checked.notFoundAt || !['MINED','IMMUTABLE'].includes(checked.status?.txStatus??''))return {settlement:checked}
 try{return await verifyHandoffMining(checked,signal,onProgress,store,prepare)}
 catch(error){return {settlement:checked,preparationError:signal.aborted?'Header preparation cancelled. Saved progress retained.':(error instanceof Error?error.message:'Header preparation failed. Saved progress retained.')}}
}
async function identity(t:HandoffTicket,w:WalletInterface,s:AbortSignal){
 if((await waitImport(()=>w.getNetwork({}),s)).network!=='testnet')throw Error('Select testnet in your wallet.')
 if((await waitImport(()=>w.getPublicKey({identityKey:true}),s)).publicKey!==t.holder)throw Error('Connect this ticket recipient’s wallet.')
 const k=t.pkg.request.recipient
 if((await waitImport(()=>w.getPublicKey({protocolID:k.protocolID,keyID:k.keyID,counterparty:k.counterparty,forSelf:true}),s)).publicKey!==k.publicKey)throw Error('Receiving key does not match your wallet.')
 s.throwIfAborted()
}
export async function reviewRecipientWallet(value:HandoffTicket,wallet:WalletInterface,snapshot:HeaderSnapshot|undefined,signal:AbortSignal):Promise<WalletObservation>{
 const t=readHandoffTicket(value);await verified(t,snapshot,true);await identity(t,wallet,signal)
 const listing=await waitImport(()=>wallet.listOutputs({basket:'ticketsv-tickets',include:'locking scripts',includeCustomInstructions:true,limit:1000}),signal)
 await identity(t,wallet,signal)
 const result=(state:WalletObservation['state'],reason:string)=>({state,reason,checkedAt:new Date().toISOString()})
 const unclear=()=>result('inconclusive','Wallet listing is incomplete or differs from this ticket. Review records before importing.')
 if(!listing||!Number.isSafeInteger(listing.totalOutputs)||listing.totalOutputs<0||listing.totalOutputs>1000||!Array.isArray(listing.outputs)||listing.outputs.length!==listing.totalOutputs)return unclear()
 const seen=new Set<string>()
 for(const o of listing.outputs){if(!o||typeof o.outpoint!=='string'||!/^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/.test(o.outpoint)||Number(o.outpoint.split('.')[1])>0xffffffff||seen.has(o.outpoint)||typeof o.spendable!=='boolean'||!Number.isSafeInteger(o.satoshis)||o.satoshis<0||typeof o.lockingScript!=='string'||o.lockingScript.length>8*1024*1024||!/^(?:[a-fA-F0-9]{2})*$/.test(o.lockingScript))return unclear();seen.add(o.outpoint)}
 const match=listing.outputs.find(o=>o.outpoint===`${t.pkg.current.txid}.${t.pkg.current.index}`)
 if(!match)return result('absent','The exact output is absent from this complete TicketSV basket listing.')
 const output=Transaction.fromAtomicBEEF(fromBase64(t.pkg.atomicBeefBase64)).outputs[t.pkg.current.index],key=t.pkg.request.recipient
 try{if(match.spendable!==true||match.satoshis!==output.satoshis||match.lockingScript!==output.lockingScript.toHex()||typeof match.customInstructions!=='string'||match.customInstructions.length>10000)return unclear();const instructions=JSON.parse(match.customInstructions);if(instructions.type!=='PushDrop'||instructions.keyID!==key.keyID||instructions.counterparty!==key.counterparty||!same(instructions.protocolID,key.protocolID))return unclear()}catch{return unclear()}
 return result('present','Matching ticket and receiving instructions found. This does not prove current chain unspentness.')
}
export async function reconcileReceivedTicket(r:HandoffSettlement,wallet:WalletInterface,snapshot:HeaderSnapshot|undefined,signal:AbortSignal,store:RecordStore<HandoffSettlement>=settlementStore){await current(r,store);const observation=await reviewRecipientWallet(r.ticket,wallet,snapshot,signal);signal.throwIfAborted();return write(r,{wallet:observation},store)}
export async function importReceivedTicket(r:HandoffSettlement,wallet:WalletInterface,snapshot:HeaderSnapshot|undefined,signal:AbortSignal,store:RecordStore<HandoffSettlement>=settlementStore){
 r=readSettlement(r);if(r.import)throw Error('Wallet import already attempted. Recheck records without retrying.');await current(r,store)
 const observation=await reviewRecipientWallet(r.ticket,wallet,snapshot,signal)
 if(observation.state==='present')return write(r,{wallet:observation},store)
 if(observation.state!=='absent')throw Error('Wallet state is inconclusive; do not import.')
 signal.throwIfAborted();r=await write(r,{import:pending(),wallet:observation},store)
 let outcome:Attempt['outcome']='unknown'
 try{
  await identity(r.ticket,wallet,signal);await current(r,store);signal.throwIfAborted();const key=r.ticket.pkg.request.recipient
  const response=await waitImport(()=>{signal.throwIfAborted();return wallet.internalizeAction({tx:fromBase64(r.ticket.pkg.atomicBeefBase64),outputs:[{outputIndex:r.ticket.pkg.current.index,protocol:'basket insertion',insertionRemittance:{basket:'ticketsv-tickets',customInstructions:JSON.stringify({type:'PushDrop',protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty})}}],description:'Receive mined TicketSV handoff ticket',seekPermission:true})},signal)
  if(response?.accepted===true)outcome='complete'
 }catch{/* A cancellation or lost response never authorizes a retry. */}
 r=await write(r,{import:finish(r.import!,outcome)},store)
 if(outcome==='complete'&&!signal.aborted)try{return await reconcileReceivedTicket(r,wallet,snapshot,signal,store)}catch{/* Keep receipt, report reconciliation separately. */}
 return r
}
