import {expect,it} from 'vitest'
import {PrivateKey,ProtoWallet,Utils} from '@bsv/sdk'
import {SCANNER_AUTH_PROTOCOL,SCANNER_AUTH_KEY,scannerPermitBytes,verifyScannerPermit} from '../src/scanner/authorization.ts'
async function fixture(){
 const wallet=new ProtoWallet(new PrivateKey(7)),server=(await wallet.getPublicKey({identityKey:true})).publicKey,now=Date.now()
 const permit={kind:'ticketsv-scanner-authorization' as const,version:1 as const,scope:'scanner' as const,network:'testnet' as const,origin:'https://ticketsv.example',identityKey:(await new ProtoWallet(new PrivateKey(8)).getPublicKey({identityKey:true})).publicKey,issuedAt:now,expiresAt:now+3600000,nonce:crypto.randomUUID(),signature:''}
 permit.signature=Utils.toBase64((await wallet.createSignature({protocolID:SCANNER_AUTH_PROTOCOL,keyID:SCANNER_AUTH_KEY,counterparty:'anyone',data:scannerPermitBytes(permit)})).signature)
 return {wallet,server,permit,now}
}
it('accepts the signed scanner permit only for its origin and server identity',async()=>{
 const f=await fixture()
 expect(verifyScannerPermit(f.permit,{origin:f.permit.origin,serverIdentity:f.server,now:f.now}).identityKey).toBe(f.permit.identityKey)
 expect(()=>verifyScannerPermit(f.permit,{origin:'https://another.example',serverIdentity:f.server,now:f.now})).toThrow()
 expect(()=>verifyScannerPermit(f.permit,{origin:f.permit.origin,serverIdentity:f.permit.identityKey,now:f.now})).toThrow()
})
it('rejects changed, expired and excessively long-lived permits without contacting a service',async()=>{
 const f=await fixture(),context={origin:f.permit.origin,serverIdentity:f.server,now:f.now}
 for(const patch of [{identityKey:f.server},{expiresAt:f.now+9*3600000},{scope:'admin'},{signature:'AAAA'},{issuedAt:f.now+60000}])expect(()=>verifyScannerPermit({...f.permit,...patch},context)).toThrow()
 expect(()=>verifyScannerPermit(f.permit,{...context,now:f.permit.expiresAt})).toThrow()
})
