import {createRoot} from 'react-dom/client'
import {ExchangeImport} from '../../src/ui/HandoffExchange.tsx'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/approved.css'
import '../../src/styles/website.css'
import '../../src/styles/handoff.css'
import '../../src/styles/handoff-modern.css'
export function mount(disabled=false){createRoot(document.getElementById('root')!).render(<div className="handoff-workspace"><main className="handoff-page"><section className="handoff-panel"><ExchangeImport label="receiving request" disabled={disabled} onLoad={value=>{document.getElementById('result')!.textContent=JSON.stringify(value)}}/><p id="result"/></section></main></div>)}
