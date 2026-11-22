import {useEffect,useRef,useState} from 'react'
import type {TicketPackage} from '../tickets/types.ts'
import {ExchangeExport} from './HandoffExchange.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'
import '../styles/ticket-qr.css'

export function TicketQR({pkg,eventName,busy=false}:{pkg:TicketPackage;eventName:string;busy?:boolean}){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{
  const element=dialog.current
  if(open&&!element?.open)element?.showModal()
  if(!open&&element?.open)element.close()
  return ()=>{if(element?.open)element.close()}
 },[open])
 return <div className="ticket-presentation">
 <button className="btn ticket-qr-trigger" aria-label="Show ticket QR" disabled={busy} onClick={()=>setOpen(true)}><DashboardIcon name="scan"/>Show ticket QR</button>
 <dialog ref={dialog} className="ticket-qr-dialog" aria-label={`${eventName} ticket QR`} onCancel={event=>{event.preventDefault();setOpen(false)}}>
 <div className="ticket-qr-heading"><div><span className="ticket-qr-label">YOUR TICKET</span><h2 className="ticket-qr-title">{eventName}</h2></div><button className="ticket-qr-close" aria-label="Close ticket QR" onClick={()=>setOpen(false)}>×</button></div>
 <p className="ticket-qr-instruction">Present this code to the ticket scanner.</p>
 {open&&<ExchangeExport value={pkg} name="ticket" qrOnly initiallyOpen/>}
 </dialog>
 </div>
}
