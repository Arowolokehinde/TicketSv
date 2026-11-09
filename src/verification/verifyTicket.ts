import {Transaction} from '@bsv/sdk'
import type {TicketPackage,ReceiveRequest,Verification,Check} from '../tickets/types.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {readTicketPackage,fromBase64} from '../tickets/codec.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient,lineageTransactions} from './authenticity.ts'
import {readSigningEvidenceBytes,verifySigningEvidence} from './signing-spv.ts'
export async function verifyTicket(value:TicketPackage,context:{trustedVenueIdentity:string;expectedRequest?:ReceiveRequest;snapshot?:HeaderSnapshot}):Promise<Verification>{
 const checks:Check[]=[];let mined=false;let anchors:number[]=[]
 const check=(name:Check['name'],fn:()=>void)=>{try{fn();checks.push({name,status:'pass',reason:`${name} check passed`})}catch(e){checks.push({name,status:'fail',reason:e instanceof Error?e.message.slice(0,300):'Check failed'})}}
 let pkg:TicketPackage
 try{pkg=readTicketPackage(JSON.stringify(value))}catch(e){return {verdict:'rejected',checks:[{name:'continuity',status:'fail',reason:e instanceof Error?e.message:'Invalid package'}],presentedTransferMined:false,anchorHeights:[]}}
 check('issuer',()=>verifyIssuer(pkg,context.trustedVenueIdentity))
 check('continuity',()=>verifyContinuity(pkg))
 if(context.expectedRequest)check('recipient',()=>verifyRecipient(pkg,context.expectedRequest!))
 else checks.push({name:'recipient',status:'incomplete',reason:'Load the independently saved receiving request to check the recipient lock'})
 try{
  const bytes=fromBase64(pkg.atomicBeefBase64),evidence=readSigningEvidenceBytes(pkg.current.txid,bytes)
  const tx=Transaction.fromAtomicBEEF(bytes)
  if(tx.toHex()!==lineageTransactions(pkg).at(-1)!.toHex())throw new Error('Atomic BEEF target does not match retained current transaction')
  if(!await tx.verify('scripts only'))throw new Error('Transaction script verification failed')
  checks.push({name:'transaction',status:'pass',reason:'Complete BEEF and applicable unmined scripts checked'})
  anchors=[...evidence.anchors]
  try{const report=await verifySigningEvidence(evidence,context.snapshot);mined=report.subjectMined;checks.push({name:'anchors',status:'pass',reason:`Merkle roots match stored headers at ${anchors.join(', ')}`})}
  catch(e){const message=e instanceof Error?e.message:'SPV check failed';checks.push({name:'anchors',status:message.includes('Verification incomplete')?'incomplete':'fail',reason:message.slice(0,300)})}
 }catch(e){checks.push({name:'transaction',status:'fail',reason:e instanceof Error?e.message.slice(0,300):'Transaction evidence failed'})}
 return {verdict:checks.some(c=>c.status==='fail')?'rejected':checks.some(c=>c.status==='incomplete')?'incomplete':'verified',checks,snapshotId:context.snapshot?.id,presentedTransferMined:mined,anchorHeights:anchors}
}
