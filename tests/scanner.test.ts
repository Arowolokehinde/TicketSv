import {afterEach,expect,it,vi} from 'vitest'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {scannerReview,scannerPolicy,verifyScannerTicket,normalizeScannerTicket} from '../src/scanner/verify.ts'
import type {Verification} from '../src/tickets/types.ts'
import {PrivateKey,ProtoWallet,Utils} from '@bsv/sdk'
import {handoffFixture} from './helpers/handoff-fixture.ts'
import {attendeeOfflineFixture} from './helpers/attendee-offline-fixture.ts'
import {attendeeEvidence} from '../src/offline/attendee-evidence.ts'
const event=(identity:string)=>({id:'event',revision:1,venueIdentity:identity,name:'Synthetic event',date:'2030-01-01',time:'18:00',timezone:'UTC',venue:'Test hall',address:'Test address',description:''})
afterEach(()=>vi.restoreAllMocks())
it('uses independently reviewed event trust, checks output binding and makes no fetch calls',async()=>{
 const f=await ticketFixture(),review=scannerReview(event(f.identity),'https://ticketsv.example')
 const get=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Network forbidden'))
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:f.pkg.current.txid,anchors:[1],subjectMined:true,proofBytes:1,snapshotId:'synthetic'})
 const result=await verifyScannerTicket(f.pkg,review)
 expect(result.policy).toBe('passes-poc-policy');expect(result.verification.checks.every(c=>c.status==='pass')).toBe(true)
 expect(result.verification.checks.find(c=>c.name==='recipient')?.reason).toContain('Presenter')
 expect(get).not.toHaveBeenCalled()
})
it('rejects a tampered signed field and an untrusted organiser, even when headers are missing',async()=>{
 const f=await ticketFixture(),review=scannerReview(event(f.identity),'https://ticketsv.example')
 const bad=structuredClone(f.pkg);bad.issuance.ticketId='tampered'
 const tampered=await verifyScannerTicket(bad,review)
 expect(tampered.policy).toBe('rejected');expect(tampered.verification.checks.some(c=>c.name==='issuer'&&c.status==='fail')).toBe(true)
 const other=await ticketFixture(),wrongWallet=new ProtoWallet(new PrivateKey(2))
 other.pkg.issuance.signatureBase64=Utils.toBase64((await wrongWallet.createSignature({protocolID:[2,'counterfoil ticket issuance'],keyID:other.pkg.issuance.signingKey.keyID,counterparty:'anyone',data:Utils.toArray(other.pkg.issuance.signedBytesBase64,'base64')})).signature)
 expect((await verifyScannerTicket(other.pkg,review)).policy).toBe('rejected')
 const wrong=scannerReview(event(new PrivateKey(2).toPublicKey().toString()),'https://ticketsv.example')
 expect((await verifyScannerTicket(f.pkg,wrong)).policy).toBe('rejected')
})
it('loads existing attendee and signed handoff exports without changing their transaction evidence',async()=>{
 const f=await attendeeOfflineFixture(),saved=attendeeEvidence(f.record,f.identity,'http://127.0.0.1:4175')
 expect(normalizeScannerTicket(saved)).toEqual(saved.pkg)
 const handoff=await handoffFixture()
 expect(normalizeScannerTicket(handoff.ticket)).toEqual(handoff.ticket.pkg)
})
it('binds scans to the selected event and never takes trust from the scanned package',async()=>{
 const f=await ticketFixture(),review=scannerReview({...event(f.identity),id:'another-event'},'https://ticketsv.example')
 expect((await verifyScannerTicket(f.pkg,review)).verification.checks[0].reason).toMatch(/different event/i)
 expect(()=>normalizeScannerTicket({kind:'ticketsv-handoff-invitation',trustedVenue:f.identity})).toThrow()
})
it('keeps unmined valid transfers online-check-required and missing anchors incomplete',async()=>{
 const f=await ticketFixture(),review=scannerReview(event(f.identity),'https://ticketsv.example')
 expect((await verifyScannerTicket(f.pkg,review)).policy).toBe('incomplete')
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:f.pkg.current.txid,anchors:[1],subjectMined:false,proofBytes:1,snapshotId:'synthetic'})
 expect((await verifyScannerTicket(f.pkg,review)).policy).toBe('online-check-required')
 const v:Verification={verdict:'incomplete',presentedTransferMined:true,checks:[],anchorHeights:[]}
 expect(scannerPolicy(v)).toBe('incomplete')
})
it('refuses replacing a saved event organiser silently and bounds imports',async()=>{
 const f=await ticketFixture(),review=scannerReview(event(f.identity),'https://ticketsv.example')
 expect(()=>scannerReview({...event(f.identity),venueIdentity:'02'+'11'.repeat(32)},'https://ticketsv.example',review)).toThrow()
 expect(()=>normalizeScannerTicket('x'.repeat(4*1024*1024+1))).toThrow(/4 MiB/)
})
