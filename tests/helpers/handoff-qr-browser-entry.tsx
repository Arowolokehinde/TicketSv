import {createRoot} from 'react-dom/client'
import {prepareTicketQRDecoder} from '../../src/handoff/ticket-qr-payload.ts'
import {ExchangeExport,ExchangeImport} from '../../src/ui/HandoffExchange.tsx'
export function mount(value:unknown,qrOnly=false){createRoot(document.getElementById('root')!).render(<><ExchangeExport value={value} name="receiving request" qrOnly={qrOnly} initiallyOpen={qrOnly}/><ExchangeImport label="receiving request" onLoad={v=>{document.body.dataset.received=JSON.stringify(v)}}/></>)}

;(window as unknown as {HandoffQRTest:{mount:typeof mount;prepareTicketQRDecoder:typeof prepareTicketQRDecoder}}).HandoffQRTest={mount,prepareTicketQRDecoder}
