import {loadExperiment} from '../tickets/experiment-store.ts'
import {loadReopeningEvidence} from '../offline/evidence-store.ts'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {loadSettlement} from '../settlement/store.ts'
export type ImportSource='download'|'journal'
export async function savedImportCandidate(source:ImportSource):Promise<ReopeningEvidence|undefined>{
 let base:ReopeningEvidence|undefined
 if(source==='download')base=await loadReopeningEvidence()
 else{
  const r=await loadExperiment()
  if(r?.attempt.phase==='transfer'&&r.attempt.status==='complete'&&r.pkg&&r.buyer)base=readReopeningEvidence({kind:'counterfoil-reopening-evidence',version:1,trusted:r.trusted,pkg:r.pkg,buyer:r.buyer})
 }
 if(!base)return undefined
 const candidate=(await loadSettlement(base.pkg.current.txid))?.candidate
 if(!candidate)throw new Error('No saved mining candidate. Use Verify mining proof locally in Online transfer submission first, then reload saved mining evidence here.')
 if(JSON.stringify({...candidate,pkg:{...candidate.pkg,atomicBeefBase64:base.pkg.atomicBeefBase64}})!==JSON.stringify(base))throw new Error('Saved settlement evidence differs from the selected ticket or receiving request. Review the saved files.')
 return candidate
}
