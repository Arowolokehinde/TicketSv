import {PublicKey,Signature} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {readExperiment} from '../tickets/experiment-store.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient} from '../verification/authenticity.ts'
import {readReopeningEvidence,type ReopeningEvidence} from './evidence.ts'

export function completedTransfer(value:unknown){
 const r=readExperiment(value)
 if(r.attempt.phase!=='transfer'||r.attempt.status!=='complete'||!r.pkg||!r.buyer)throw new Error('A completed transfer diagnostic is required; review the existing wallet outcome.')
 return {...r,pkg:r.pkg,buyer:r.buyer}
}
export async function verifySavedTransfer(value:unknown,snapshot:HeaderSnapshot|undefined){
 const r=completedTransfer(value)
 // Trust and buyer intent were saved separately by the original online preparation.
 // This reads the local journal, never an imported package's self-declared trust.
 return verifyTicket(r.pkg,{trustedVenueIdentity:r.trusted,expectedRequest:r.buyer,snapshot})
}
export type KeyAccessEvidence={publicKey:string;challenge:number[];signature:number[];checkedAt:string}
type KeyWallet=Pick<WalletInterface,'getNetwork'|'getPublicKey'|'createSignature'>
export async function proveSavedKey(wallet:KeyWallet,value:unknown,signal:AbortSignal,log:(line:string)=>void=()=>{}):Promise<KeyAccessEvidence>{
 return proveEvidenceKey(wallet,completedTransfer(value),signal,log)
}
async function proveEvidenceKey(wallet:KeyWallet,r:Pick<ReopeningEvidence,'trusted'|'pkg'|'buyer'>,signal:AbortSignal,log:(line:string)=>void):Promise<KeyAccessEvidence>{
 const key=r.buyer.recipient
 verifyIssuer(r.pkg,r.trusted);verifyContinuity(r.pkg);verifyRecipient(r.pkg,r.buyer)
 async function call<T>(method:string,fn:()=>Promise<T>):Promise<T>{
  signal.throwIfAborted();log(`${method} — started`)
  try{
   const result=await new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new Error('Cancelled'))
    signal.addEventListener('abort',abort,{once:true})
    Promise.resolve().then(()=>{signal.throwIfAborted();return fn()}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
   })
   signal.throwIfAborted();log(`${method} — returned`);return result
  }catch(e){log(`${method} — failed`);throw e}
 }
 async function identity(){
  if((await call('getNetwork',()=>wallet.getNetwork({}))).network!=='testnet')throw new Error('Select testnet for this key access check')
  if((await call('getPublicKey',()=>wallet.getPublicKey({identityKey:true}))).publicKey!==r.trusted)throw new Error('This experiment requires the original same-wallet identity')
 }
 await identity()
 if((await call('getPublicKey',()=>wallet.getPublicKey({protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty,forSelf:true}))).publicKey!==key.publicKey)throw new Error('Wallet receiving key does not match the saved buyer request')
 const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)))
 const challenge=Array.from(new TextEncoder().encode(JSON.stringify({purpose:'Counterfoil offline reopening key access v1',network:'testnet',outpoint:r.pkg.current,requestId:r.buyer.requestId,nonce})))
 const {signature}=await call('createSignature',()=>wallet.createSignature({protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty,data:challenge}))
 try{
  if(!Array.isArray(signature)||signature.length>80||!signature.every(n=>Number.isInteger(n)&&n>=0&&n<=255)||!Signature.fromDER(signature).verify(challenge,PublicKey.fromString(key.publicKey)))throw new Error('invalid')
 }catch{throw new Error('Receiving-key challenge signature is invalid')}
 await identity();signal.throwIfAborted()
 return {publicKey:key.publicKey,challenge,signature,checkedAt:new Date().toISOString()}
}

// Cover lazy client loading as well as the wallet methods. The loader may not
// itself be cancellable; a late client must never start the challenge sequence.
export function checkSavedKey(loadWallet:()=>Promise<KeyWallet>,value:unknown,signal:AbortSignal,log:(line:string)=>void=()=>{}):Promise<KeyAccessEvidence>{
 return loadAndCheck(loadWallet,()=>completedTransfer(value),signal,log)
}
export function checkEvidenceKey(loadWallet:()=>Promise<KeyWallet>,value:unknown,signal:AbortSignal,log:(line:string)=>void=()=>{}):Promise<KeyAccessEvidence>{
 return loadAndCheck(loadWallet,()=>readReopeningEvidence(value),signal,log)
}
function loadAndCheck(loadWallet:()=>Promise<KeyWallet>,read:()=>Pick<ReopeningEvidence,'trusted'|'pkg'|'buyer'>,signal:AbortSignal,log:(line:string)=>void):Promise<KeyAccessEvidence>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new Error('Cancelled'))}
  if(signal.aborted){abort();return}
  signal.addEventListener('abort',abort,{once:true})
  Promise.resolve().then(()=>{signal.throwIfAborted();return loadWallet()})
   .then(wallet=>{signal.throwIfAborted();return proveEvidenceKey(wallet,read(),signal,log)})
   .then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
 })
}
