import {createRoot,type Root} from 'react-dom/client'
import {ScannerPage} from '../../src/ui/ScannerPage.tsx'
import {ticketFixture} from './ticket-fixture.ts'
import {scannerReview} from '../../src/scanner/verify.ts'
import {scannerSetupStore} from '../../src/scanner/store.ts'
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
export function mount(){root=createRoot(document.getElementById('root')!);root.render(<ScannerPage/>)}
export function unmount(){root.unmount()}
