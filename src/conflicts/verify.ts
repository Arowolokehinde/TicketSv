import {Transaction} from '@bsv/sdk'
import type {HeaderSnapshot} from '../headers/validate.ts'
import type {Verification} from '../tickets/types.ts'
import {readReopeningEvidence} from '../offline/evidence.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import {transactionSummary,verifyMinedCandidate} from '../settlement/evidence.ts'
import type {ArcObservation} from '../settlement/types.ts'
import type {ConflictPair,ConflictBranch,ConflictPairReview,ConflictVerdict} from './types.ts'
export function doorVerdict(v:Verification){return v.verdict==='rejected'?'rejected':v.verdict==='incomplete'?'incomplete':v.presentedTransferMined?'passes-poc-policy':'online-check-required'}
export async function reviewConflictPair(value:ConflictPair,snapshot:HeaderSnapshot|undefined):Promise<ConflictPairReview>{
 const blank:Verification={verdict:'rejected',checks:[],presentedTransferMined:false,anchorHeights:[]}
 const result:ConflictPairReview={verdict:'rejected',reason:'Invalid pair',checks:{a:blank,b:blank},reviews:{},snapshotId:snapshot?.id}
 try{
  const a=readReopeningEvidence(value.a),b=readReopeningEvidence(value.b)
  for(const branch of ['a','b'] as const){const e=branch==='a'?a:b;result.checks[branch]=await verifyTicket(e.pkg,{trustedVenueIdentity:e.trusted,expectedRequest:e.buyer,snapshot})}
  if(a.trusted!==b.trusted||JSON.stringify(a.pkg.issuance)!==JSON.stringify(b.pkg.issuance))throw new Error('Branches must have the same trusted issuance')
  if(a.pkg.current.txid===b.pkg.current.txid)throw new Error('Load two different transactions')
  if(a.buyer.requestId===b.buyer.requestId||a.buyer.recipient.publicKey===b.buyer.recipient.publicKey)throw new Error('Branches require different receiving keys and requests')
  if(a.pkg.lineageRawTxs.length!==2||b.pkg.lineageRawTxs.length!==2||a.pkg.lineageRawTxs[0]!==b.pkg.lineageRawTxs[0])throw new Error('Both branches must spend the same fresh issuance')
  const origin=a.pkg.issuance.origin,ticket=`${origin.txid}.${origin.index}`
  const txs=[a,b].map(e=>Transaction.fromHex(e.pkg.lineageRawTxs[1]))
  const ins=txs.map(tx=>tx.inputs.map(i=>`${i.sourceTXID}.${i.sourceOutputIndex}`))
  if(ins.some(xs=>xs.length!==2||new Set(xs).size!==2||!xs.includes(ticket))||ins[0].filter(i=>ins[1].includes(i)).length!==1)throw new Error('Branches must share only the designated ticket input, with separate fee inputs')
  if(result.checks.a.verdict==='rejected'||result.checks.b.verdict==='rejected')throw new Error('One or both ticket verifications rejected')
  for(const branch of ['a','b'] as const){const e=branch==='a'?a:b,s=transactionSummary(e);if(s.fee!==1000||s.outputs.length!==1||s.outputs[0].satoshis!==1)throw new Error('Unexpected conflict fixture outputs or fee');result.reviews[branch]=s}
  result.sharedTicket=ticket;result.verdict=result.checks.a.verdict==='incomplete'||result.checks.b.verdict==='incomplete'?'incomplete':'verified'
  result.reason=result.verdict==='verified'?'Both branches verify individually; they spend the same ticket. This does not establish which branch will settle.':'Required local evidence is incomplete'
 }catch(e){result.verdict='rejected';result.reason=e instanceof Error?e.message:'Invalid conflict pair'}
 return result
}
export async function verifyCompetingSpend(pair:ConflictPair,winner:ConflictBranch,o:ArcObservation,snapshot:HeaderSnapshot|undefined):Promise<ConflictVerdict>{
 const review=await reviewConflictPair(pair,snapshot)
 if(review.verdict!=='verified')return {verdict:review.verdict,reason:review.reason}
 if(o.txStatus!=='MINED'&&o.txStatus!=='IMMUTABLE')return {verdict:'incomplete',reason:'No current mining proof for this branch; provider status alone is not proof of conflict'}
 if(!o.merklePath||!o.blockHash||!o.blockHeight)return {verdict:'incomplete',reason:'Mining proof or block details missing'}
 try{
  const verified=await verifyMinedCandidate(pair[winner],o,snapshot)
  if(verified.verdict!=='verified'||!verified.presentedTransferMined)return {verdict:verified.verdict==='rejected'?'rejected':'incomplete',reason:verified.checks.filter(c=>c.status!=='pass').map(c=>c.reason).join('; ')||'Subject mining not verified'}
  return {verdict:'conflicting-spend-mined-in-local-snapshot',reason:'A conflicting spend is mined in the locally checked snapshot. Full best-chain selection and current unspentness are not established.',winner:pair[winner].pkg.current.txid,loser:pair[winner==='a'?'b':'a'].pkg.current.txid,snapshotId:verified.snapshotId}
 }catch(e){return {verdict:'rejected',reason:e instanceof Error?e.message:'Invalid mining proof'}}
}
