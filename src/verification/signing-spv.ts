import { Beef, Transaction } from '@bsv/sdk'
import {createLocalTracker,MissingHeaderError} from '../headers/tracker.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {fromBase64} from '../tickets/codec.ts'
export const MAX_EVIDENCE_FILE_BYTES=4*1024*1024
export type SigningEvidence=Readonly<{txid:string;atomicBeef:readonly number[];anchors:readonly number[];requiredHeight:number}>
export type SpvReport={txid:string;anchors:number[];subjectMined:boolean;proofBytes:number;snapshotId:string}
export function readSigningEvidence(text:string):SigningEvidence {
 if(text.length>MAX_EVIDENCE_FILE_BYTES||new TextEncoder().encode(text).length>MAX_EVIDENCE_FILE_BYTES)throw new Error('Signing result exceeds 4 MiB limit')
 const value=JSON.parse(text)
 if(value?.kind!=='counterfoil-signing-result' || value.network!=='testnet')throw new Error('Load a Counterfoil testnet signing-result JSON file')
 const f=value.final
 if(!f || (f.atomicBeef!==undefined&&f.atomicBeefBase64!==undefined))throw new Error('Invalid signing evidence bytes')
 return readSigningEvidenceBytes(f.txid,f.atomicBeefBase64===undefined?f.atomicBeef:fromBase64(f.atomicBeefBase64))
}
export function readSigningEvidenceBytes(txid:unknown,atomicBeef:unknown):SigningEvidence {
 if(typeof txid!=='string' || !/^[0-9a-f]{64}$/.test(txid) || !Array.isArray(atomicBeef) || atomicBeef.length<1 || atomicBeef.length>MAX_EVIDENCE_FILE_BYTES || !atomicBeef.every((v:unknown)=>Number.isInteger(v) && (v as number)>=0 && (v as number)<=255))throw new Error('Invalid signing evidence bytes')
 const f={txid,atomicBeef:atomicBeef as number[]}
 const beef=Beef.fromBinary(f.atomicBeef)
 if(!beef.isAtomic() || beef.atomicTxid!==f.txid || beef.txs.length>128 || !beef.isValid(false))throw new Error('Incomplete or invalid Atomic BEEF')
 const tx=Transaction.fromAtomicBEEF(f.atomicBeef)
 if(tx.id('hex')!==f.txid)throw new Error('Transaction ID does not match evidence')
 const roots=beef.verifyValid(false)
 const anchors=Object.keys(roots.roots).map(Number).sort((a,b)=>a-b)
 if(!anchors.length || anchors.some(h=>!Number.isSafeInteger(h) || h<0))throw new Error('Missing or invalid Merkle anchors')
 const maturityHeights=beef.txs.flatMap(item=>{
  if(item.bumpIndex===undefined)return []
  const path=beef.bumps[item.bumpIndex]
  return path.indexOf(item.txid)===0?[path.blockHeight+100]:[]
 })
 const requiredHeight=Math.max(...anchors,...maturityHeights)
 return Object.freeze({txid:f.txid,atomicBeef:Object.freeze([...f.atomicBeef]),anchors:Object.freeze(anchors),requiredHeight})
}
export async function verifySigningEvidence(evidence:SigningEvidence,snapshot:HeaderSnapshot|undefined):Promise<SpvReport> {
 // Reparse at the public boundary; do not trust caller-supplied anchor labels.
 const checked=readSigningEvidenceBytes(evidence.txid,evidence.atomicBeef)
 if(!snapshot)throw new MissingHeaderError(checked.anchors[0])
 const tracker=createLocalTracker(snapshot)
 const beef=Beef.fromBinary([...checked.atomicBeef])
 // Inspect every available anchor before missing headers or maturity can make
 // the outcome incomplete. A known root contradiction must always reject.
 const storedHeights=new Set(snapshot.headers.map(h=>h.height))
 for(const [height,root] of Object.entries(beef.verifyValid(false).roots)){
  if(storedHeights.has(Number(height))&&!await tracker.isValidRootForHeight(root,Number(height)))throw new Error('Merkle proof does not match the stored header snapshot')
 }
 if(snapshot.headers.at(-1)!.height<checked.requiredHeight && checked.requiredHeight>Math.max(...checked.anchors))throw new Error(`Verification incomplete — coinbase maturity requires local headers through ${checked.requiredHeight}. Sync required headers; saved progress is retained between bounded operations.`)
 if(!await beef.verify(tracker,false))throw new Error('Merkle proof does not match the stored header snapshot')
 const tx=Transaction.fromAtomicBEEF([...checked.atomicBeef])
 if(!await tx.verify(tracker))throw new Error('Transaction scripts or chain evidence failed verification')
 return {txid:checked.txid,anchors:[...checked.anchors],subjectMined:!!tx.merklePath,proofBytes:checked.atomicBeef.length,snapshotId:snapshot.id}
}
