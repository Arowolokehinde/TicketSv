import {Hash,Utils} from '@bsv/sdk'
import {readHandoffTicket,verifyHandoffTicket} from './evidence.ts'
import {newSettlement,readSettlement,type HandoffSettlement} from './settlement.ts'
import type {HandoffTicket} from './types.ts'

export type SettlementReport=Omit<HandoffSettlement,'ticket'|'id'|'revision'|'version'>
export type ReceivedArchive={ticket:HandoffTicket;settlement?:SettlementReport}
export const ARCHIVE_BYTES=4*1024*1024
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
 return JSON.stringify(value)
}
const digest=(value:unknown)=>Utils.toHex(Hash.sha256(Utils.toArray(canonical(value),'utf8')))
const withoutDate=(t:HandoffTicket)=>({...t,savedAt:''})
export function archiveIdentity(a:ReceivedArchive):string{return digest({ticket:withoutDate(a.ticket),...(a.settlement?{settlement:{submit:a.settlement.submit,import:a.settlement.import,status:a.settlement.status,notFoundAt:a.settlement.notFoundAt,wallet:a.settlement.wallet}}:{})})}
export function archiveBinding(t:HandoffTicket):string{
 const stripped=(t:HandoffTicket)=>({...withoutDate(t),pkg:{...t.pkg,atomicBeefBase64:''},...(t.issuanceEvidence?{issuanceEvidence:{...t.issuanceEvidence,savedAt:'',pkg:{...t.issuanceEvidence.pkg,atomicBeefBase64:''}}}:{})})
 return digest(stripped(t))
}
export async function validateReceivedArchive(value:unknown,owner:string):Promise<ReceivedArchive>{
 if(!value||typeof value!=='object'||Array.isArray(value)||new TextEncoder().encode(JSON.stringify(value)).length>ARCHIVE_BYTES)throw Error('Received ticket archive is invalid or exceeds 4 MiB.')
 const v=value as ReceivedArchive,ticket=readHandoffTicket(v.ticket)
 if(!ticket.request||ticket.holder!==owner||ticket.request.recipientIdentity!==owner)throw Error('Only the signed recipient can synchronise this handoff.')
 const report=await verifyHandoffTicket(ticket)
 // Missing local headers are expected on the API. Never save a verified verdict.
 if(report.verdict==='rejected'||report.checks.some(c=>c.status!=='pass'&&!(c.name==='anchors'&&c.status==='incomplete')))throw Error('Received ticket transaction or signature checks failed.')
 let settlement:SettlementReport|undefined
 if(v.settlement!==undefined){
  const raw=v.settlement as Partial<HandoffSettlement>
  const checked=readSettlement({...newSettlement(ticket),...raw,ticket:raw.ticket??ticket})
  if(canonical(withoutDate(checked.ticket))!==canonical(withoutDate(ticket)))throw Error('Reported settlement belongs to a different ticket.')
  const {ticket:_ticket,id:_id,revision:_revision,version:_version,...report}=checked
  settlement=report
 }
 return {ticket,...(settlement?{settlement}:{})}
}
