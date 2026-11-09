import {it,expect,vi} from 'vitest'
import {PrivateKey,ProtoWallet,Transaction,MerklePath,Utils,LockingScript,OP} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import {readTicketPackage,readReceiveRequest} from '../src/tickets/codec.ts'
import {issuanceBytes} from '../src/tickets/script.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient} from '../src/verification/authenticity.ts'
import {verifyTicket} from '../src/verification/verifyTicket.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import {readSigningEvidence} from '../src/verification/signing-spv.ts'
it('verifies a publicly derived venue signature, signed continuity and saved recipient with no fetch',async()=>{
 const f=await ticketFixture();const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('forbidden'))
 try {const p=readTicketPackage(JSON.stringify(f.pkg));expect(()=>verifyIssuer(p,f.identity)).not.toThrow();expect(()=>verifyContinuity(p)).not.toThrow();expect(()=>verifyRecipient(p,f.destination)).not.toThrow();expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore()}
})
it('uses exact canonical issuance bytes and rejects changed signed fields or copied signature',async()=>{
 const f=await ticketFixture();expect(new TextDecoder().decode(Uint8Array.from(issuanceBytes('event','ticket',f.pkg.issuance.origin)))).toBe(JSON.stringify(['offline-ticket-issuance',1,'testnet','event','ticket',f.issue.id('hex'),0]))
 const changed=structuredClone(f.pkg);changed.issuance.ticketId='tampered';expect(()=>verifyIssuer(changed,f.identity)).toThrow(/signed|signature/i)
 const copied=structuredClone(f.pkg);copied.issuance.origin.txid='22'.repeat(32);expect(()=>verifyIssuer(copied,f.identity)).toThrow()
})
it('rejects an untrusted venue and a wrong signature under the trusted label',async()=>{
 const f=await ticketFixture();const wrong=new ProtoWallet(new PrivateKey(2))
 expect(()=>verifyIssuer(f.pkg,(new PrivateKey(2)).toPublicKey().toString())).toThrow(/trusted/i)
 f.pkg.issuance.signatureBase64=Utils.toBase64((await wrong.createSignature({protocolID:[2,'counterfoil ticket issuance'],keyID:f.pkg.issuance.signingKey.keyID,counterparty:'anyone',data:issuanceBytes('event','ticket',f.pkg.issuance.origin)})).signature)
 expect(()=>verifyIssuer(f.pkg,f.identity)).toThrow(/signature/i)
})
it('rejects omitted or duplicated hops, wrong target, duplicate successors and altered locked metadata',async()=>{
 const f=await ticketFixture()
 const missing=structuredClone(f.pkg);missing.lineageRawTxs.shift();expect(()=>verifyContinuity(missing)).toThrow()
 const cycle=structuredClone(f.pkg);cycle.lineageRawTxs.push(cycle.lineageRawTxs[0]);expect(()=>verifyContinuity(cycle)).toThrow()
 const target=structuredClone(f.pkg);target.current.txid=f.issue.id('hex');expect(()=>verifyContinuity(target)).toThrow()
 const duplicate=Transaction.fromHex(f.transfer.toHex());duplicate.outputs.push(duplicate.outputs[0]);const dup=structuredClone(f.pkg);dup.lineageRawTxs[1]=duplicate.toHex();dup.current.txid=duplicate.id('hex');expect(()=>verifyContinuity(dup)).toThrow(/successor/i)
 const bad=structuredClone(f.pkg);bad.issuance.eventId='copied-event';expect(()=>verifyContinuity(bad)).toThrow()
})
it('retains provenance after BEEF compaction and rejects unsigned retained hops',async()=>{
 const f=await ticketFixture();f.transfer.merklePath=new MerklePath(2,[[{offset:1,hash:f.transfer.id('hex'),txid:true},{offset:0,hash:'33'.repeat(32)}]])
 f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 expect(()=>verifyContinuity(f.pkg)).not.toThrow();expect(()=>verifyIssuer(f.pkg,f.identity)).not.toThrow()
 const broken=Transaction.fromHex(f.pkg.lineageRawTxs[1]);broken.lockTime++
 f.pkg.lineageRawTxs[1]=broken.toHex();f.pkg.current.txid=broken.id('hex');expect(()=>verifyContinuity(f.pkg)).toThrow(/signature|script/i)
})
it('compares the actual recipient key and exact saved request, not the envelope label',async()=>{
 const f=await ticketFixture();expect(()=>verifyRecipient(f.pkg,f.source)).toThrow(/recipient|request/i)
 const copied=structuredClone(f.pkg);copied.request=f.source;expect(()=>verifyRecipient(copied,f.source)).toThrow(/recipient|request/i)
})
it('a known issuer failure dominates missing headers; valid provenance alone remains incomplete',async()=>{
 const f=await ticketFixture();const result=await verifyTicket(f.pkg,{trustedVenueIdentity:f.identity,expectedRequest:f.destination})
 expect(result.verdict).toBe('incomplete');expect(result.checks.find(c=>c.name==='issuer')?.status).toBe('pass')
 f.pkg.issuance.ticketId='altered';expect((await verifyTicket(f.pkg,{trustedVenueIdentity:f.identity,expectedRequest:f.destination})).verdict).toBe('rejected')
})
it('rejects an available but wrong Merkle root before reporting missing coinbase depth',async()=>{
 const f=await ticketFixture(),funding=f.issue.inputs[0].sourceTransaction!
 funding.merklePath=new MerklePath(b.height,[[{offset:0,hash:funding.id('hex'),txid:true}]])
 f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
 const result=await verifyTicket(f.pkg,{trustedVenueIdentity:f.identity,expectedRequest:f.destination,snapshot})
 expect(result.verdict).toBe('rejected');expect(result.checks.find(c=>c.name==='anchors')?.status).toBe('fail')
})
it('verifies a package below 4 MiB without rejecting expanded intermediate JSON',async()=>{
 const f=await ticketFixture()
 const issue=new Transaction(f.issue.version,f.issue.inputs,[...f.issue.outputs,{satoshis:0,lockingScript:new LockingScript().writeOpCode(OP.OP_RETURN).writeBin(Array(1100000).fill(255)) as LockingScript}])
 const origin={txid:issue.id('hex'),index:0},keyID=`${origin.txid}.0`,data=issuanceBytes('event','ticket',origin),protocolID:[2,string]=[2,'counterfoil ticket issuance']
 const pkg={...f.pkg,current:origin,request:f.source,lineageRawTxs:[issue.toHex()],atomicBeefBase64:Utils.toBase64(issue.toAtomicBEEF()),issuance:{...f.pkg.issuance,origin,signedBytesBase64:Utils.toBase64(data),signatureBase64:Utils.toBase64((await f.wallet.createSignature({protocolID,keyID,counterparty:'anyone',data})).signature),signingKey:{...f.pkg.issuance.signingKey,keyID,publicKey:(await f.wallet.getPublicKey({protocolID,keyID,counterparty:'anyone',forSelf:true})).publicKey}}}
 expect(new TextEncoder().encode(JSON.stringify(pkg)).length).toBeLessThan(4*1024*1024)
 const result=await verifyTicket(readTicketPackage(JSON.stringify(pkg)),{trustedVenueIdentity:f.identity,expectedRequest:f.source})
 expect(result.verdict).toBe('incomplete');expect(result.checks.find(c=>c.name==='transaction')?.status).toBe('pass')
 const evidence=readSigningEvidence(JSON.stringify({kind:'counterfoil-signing-result',network:'testnet',final:{txid:origin.txid,atomicBeefBase64:pkg.atomicBeefBase64}}))
 expect(evidence.txid).toBe(origin.txid)
},20000)
it('rejects oversize, malformed UTF-8 IDs/base64, excessive lineage and invalid key conventions',async()=>{
 const f=await ticketFixture();for(const mutate of [(p:typeof f.pkg)=>p.issuance.eventId='x'.repeat(129),(p:typeof f.pkg)=>p.issuance.ticketId='\ud800',(p:typeof f.pkg)=>p.atomicBeefBase64+='!',(p:typeof f.pkg)=>p.lineageRawTxs=Array(102).fill(p.lineageRawTxs[0])]){const p=structuredClone(f.pkg);mutate(p);expect(()=>readTicketPackage(JSON.stringify(p))).toThrow()}
 expect(()=>readTicketPackage(' '.repeat(4*1024*1024+1))).toThrow()
 expect(()=>readReceiveRequest(JSON.stringify({...f.source,recipient:{...f.source.recipient,counterparty:'anyone'}}))).toThrow()
})
