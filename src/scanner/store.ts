import {createStore} from '../handoff/store.ts'
import {readOrganiserReview,type OrganiserReview} from '../handoff/organiser-review.ts'
import {normalizeScannerTicket} from './verify.ts'
import type {TicketPackage} from '../tickets/types.ts'
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
