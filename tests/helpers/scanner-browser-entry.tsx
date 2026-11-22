import {createRoot,type Root} from 'react-dom/client'
import {ScannerPage} from '../../src/ui/ScannerPage.tsx'
import {ticketFixture} from './ticket-fixture.ts'
import {scannerReview} from '../../src/scanner/verify.ts'
import {scannerSetupStore,spentListStore} from '../../src/scanner/store.ts'
import type {SpentList} from '../../src/scanner/spent.ts'
import {saveSnapshot} from '../../src/headers/store.ts'
import {validateSnapshot} from '../../src/headers/validate.ts'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/approved.css'
import '../../src/styles/website.css'
import '../../src/styles/handoff.css'
import '../../src/styles/handoff-modern.css'
import '../../src/styles/scanner.css'
let root:Root
export async function seed(){
 const f=await ticketFixture()
 const event={id:'event',revision:1,venueIdentity:f.identity,name:'Synthetic scanner event',date:'2030-01-01',time:'18:00',timezone:'UTC',venue:'Test hall',address:'Test address',description:''}
 await scannerSetupStore.save({id:'active',revision:0,review:scannerReview(event,location.origin),preparedAt:new Date().toISOString()},undefined)
 return f.pkg
}
// The door-memory UI tests use the double-sale fixture with its mined block, so
// both copies genuinely verify; this saves that event's scanner setup and headers.
export async function seedDoor(event:Parameters<typeof scannerReview>[0],snapshot:unknown,list?:SpentList){
 await scannerSetupStore.save({id:'active',revision:0,review:scannerReview(event,location.origin),preparedAt:new Date().toISOString()},undefined)
 await saveSnapshot(validateSnapshot(snapshot))
 if(list)await spentListStore.save(list,undefined)
}
export function mount(){root=createRoot(document.getElementById('root')!);root.render(<ScannerPage/>)}
export function unmount(){root.unmount()}
