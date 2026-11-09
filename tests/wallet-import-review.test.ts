import {afterEach,it,expect,vi} from 'vitest'
import {MerklePath,Utils} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {reviewWalletImport} from '../src/wallet/import-review.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
async function setup(){
 const f=await ticketFixture()
 f.transfer.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.pkg.current.txid,txid:true}]])
 f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const evidence={kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:f.identity,pkg:f.pkg,buyer:f.destination}
 // Synthetic ticket has real signatures but no genuine mined anchor.
 vi.spyOn(spv,'verifySigningEvidence').mockImplementation(async(_,s)=>{if(!s)throw new Error('Verification incomplete — required block header missing');return {txid:f.pkg.current.txid,anchors:[1],subjectMined:true,proofBytes:100,snapshotId:s.id}})
 const output={outpoint:`${f.pkg.current.txid}.0`,satoshis:1,spendable:true,lockingScript:f.transfer.outputs[0].lockingScript.toHex(),customInstructions:JSON.stringify({...f.destination.recipient,type:'PushDrop'})}
 const wallet={getNetwork:vi.fn(async()=>({network:'testnet' as const})),getVersion:async()=>({version:'wallet-brc100-1.0.0'}),getPublicKey:f.wallet.getPublicKey.bind(f.wallet),listOutputs:vi.fn(async()=>({totalOutputs:1,outputs:[output]}))}
 return {evidence,wallet,output}
}
afterEach(()=>vi.restoreAllMocks())
it('reports an exact same-wallet basket record as present, never as a newly imported ticket',async()=>{
 const t=await setup(),logs:string[]=[]
 const result=await reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal,x=>logs.push(x))
 expect(result.state).toBe('present');expect(result.outpoint).toBe(t.output.outpoint)
 expect(logs.filter(x=>x.endsWith('started')).map(x=>x.split(' ')[0])).toEqual(['getNetwork','getPublicKey','getVersion','getPublicKey','listOutputs','getNetwork','getPublicKey'])
 expect(t.wallet.listOutputs).toHaveBeenCalledWith({basket:'counterfoil-ticket-experiment',include:'locking scripts',includeCustomInstructions:true,limit:1000})
})
it('only a complete empty listing can report absence',async()=>{
 const t=await setup();t.wallet.listOutputs.mockResolvedValue({totalOutputs:0,outputs:[]})
 expect((await reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal)).state).toBe('absent')
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:2,outputs:[t.output]})
 expect((await reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal)).state).toBe('inconclusive')
})
it('mismatched or duplicate basket records do not authorize import or imply custody',async()=>{
 const t=await setup()
 for(const output of [{...t.output,satoshis:2},{...t.output,lockingScript:'51'},{...t.output,customInstructions:'{}'},{...t.output,spendable:false}]){
  t.wallet.listOutputs.mockResolvedValue({totalOutputs:1,outputs:[output]})
  expect((await reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal)).state).toBe('inconclusive')
 }
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:2,outputs:[t.output,t.output]})
 expect((await reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal)).state).toBe('inconclusive')
})
it('missing local anchors or unmined evidence stop before opening a wallet',async()=>{
 const t=await setup(),load=vi.fn(async()=>t.wallet)
 await expect(reviewWalletImport(load,t.evidence,undefined,new AbortController().signal)).rejects.toThrow(/mined|incomplete/i)
 vi.mocked(spv.verifySigningEvidence).mockResolvedValue({txid:t.evidence.pkg.current.txid,anchors:[1],subjectMined:false,proofBytes:100,snapshotId:snapshot.id})
 await expect(reviewWalletImport(load,t.evidence,snapshot,new AbortController().signal)).rejects.toThrow(/mined/i)
 expect(load).not.toHaveBeenCalled()
})
it('wrong network, receiving key or identity prevents a basket lookup',async()=>{
 const t=await setup(),s=new AbortController().signal
 await expect(reviewWalletImport(async()=>({...t.wallet,getNetwork:async()=>({network:'mainnet' as const})}),t.evidence,snapshot,s)).rejects.toThrow(/testnet/i)
 await expect(reviewWalletImport(async()=>({...t.wallet,getPublicKey:async()=>({publicKey:t.evidence.trusted})}),t.evidence,snapshot,s)).rejects.toThrow(/receiving/i)
 await expect(reviewWalletImport(async()=>({...t.wallet,getPublicKey:async()=>({publicKey:t.evidence.buyer.recipient.publicKey})}),t.evidence,snapshot,s)).rejects.toThrow(/identity/i)
 expect(t.wallet.listOutputs).not.toHaveBeenCalled()
})
it('a wallet network switch after lookup prevents a completed observation',async()=>{
 const t=await setup();t.wallet.getNetwork.mockResolvedValueOnce({network:'testnet'}).mockImplementationOnce(async()=>({network:'mainnet' as 'testnet'}))
 await expect(reviewWalletImport(async()=>t.wallet,t.evidence,snapshot,new AbortController().signal)).rejects.toThrow(/testnet/i)
})
it('cancellation releases a stalled loader and never starts late wallet calls',async()=>{
 const t=await setup(),c=new AbortController();let release!:(w:typeof t.wallet)=>void
 let started!:()=>void;const starting=new Promise<void>(resolve=>{started=resolve})
 const result=reviewWalletImport(()=>{started();return new Promise(r=>{release=r})},t.evidence,snapshot,c.signal)
 const rejected=expect(result).rejects.toThrow(/cancel/i)
 await starting;c.abort(new Error('Cancelled'));await rejected;release(t.wallet);await Promise.resolve()
 expect(t.wallet.getNetwork).not.toHaveBeenCalled()
})
