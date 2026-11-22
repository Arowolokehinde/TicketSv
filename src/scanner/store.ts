import {createStore} from '../handoff/store.ts'
import {readOrganiserReview,type OrganiserReview} from '../handoff/organiser-review.ts'
import {normalizeScannerTicket} from './verify.ts'
import type {TicketPackage} from '../tickets/types.ts'
import type {SpentList} from './spent.ts'
export type ScannerSetup={id:'active';revision:number;review:OrganiserReview;preparedAt:string}
export type ScannerEvidence={id:'last';revision:number;pkg:TicketPackage}
export function readScannerSetup(value:unknown,previous?:ScannerSetup):ScannerSetup{
 const v=value as ScannerSetup
 if(!v||v.id!=='active'||!Number.isSafeInteger(v.revision)||v.revision<0||typeof v.preparedAt!=='string'||!Number.isFinite(Date.parse(v.preparedAt)))throw Error('Saved scanner setup is invalid. Prepare this device online.')
 const old=previous?.review.eventId===v.review?.eventId?previous.review:undefined
 return {id:'active',revision:v.revision,review:readOrganiserReview(v.review,old),preparedAt:v.preparedAt}
}
export const scannerSetupStore=createStore('scanner-setup',readScannerSetup)
export const scannerEvidenceStore=createStore('scanner-evidence',(value:unknown):ScannerEvidence=>{
 const v=value as ScannerEvidence
 if(!v||v.id!=='last'||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('Saved scanner evidence is invalid.')
 return {id:'last',revision:v.revision,pkg:normalizeScannerTicket(v.pkg)}
})
// One list per event: every ticket followed at the last preparation, and the
// ticket outputs already spent then.
export function readSpentList(value:unknown):SpentList{
 const v=value as SpentList,point=(p:unknown)=>typeof p==='string'&&/^[0-9a-f]{64}\.\d{1,10}$/.test(p)
 if(!v||typeof v.id!=='string'||!v.id||!Number.isSafeInteger(v.revision)||v.revision<0||typeof v.checkedAt!=='string'||!Number.isFinite(Date.parse(v.checkedAt))||!Array.isArray(v.tickets)||!Array.isArray(v.spent)||!v.tickets.every(point)||!v.spent.every(point))throw Error('Saved spent list is invalid.')
 return {id:v.id,revision:v.revision,checkedAt:v.checkedAt,tickets:[...v.tickets],spent:[...v.spent]}
}
export const spentListStore=createStore('scanner-spent',readSpentList)
