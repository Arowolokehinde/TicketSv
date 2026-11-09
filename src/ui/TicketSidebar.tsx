import {DashboardIcon,type DashboardIconName} from './DashboardIcon.tsx'
const links:Array<{id:string;label:string;href:string;icon:DashboardIconName}>=[
 {id:'dashboard',label:'Dashboard',href:'/tickets',icon:'grid'},
 {id:'receive',label:'Receive ticket',href:'/offline/handoff?step=receive',icon:'receive'},
 {id:'transfer',label:'Transfer ticket',href:'/offline/handoff?step=prepare',icon:'transfer'},
 {id:'events',label:'Explore events',href:'/events',icon:'explore'},
 {id:'create-event',label:'Create event',href:'/venue',icon:'calendar'},
]
// Navigation has no account provider or network dependency, so it also works
// around the offline handoff screens without initiating authentication.
export function TicketSidebar({active,disabled=false}:{active:string;disabled?:boolean}){
 return <nav className="rail" aria-label="Ticket holder navigation"><div className="brand sidebar-label">Menu</div>{links.map(link=><a key={link.id} href={link.href} aria-current={active===link.id?'page':undefined} aria-disabled={disabled||undefined} onClick={event=>{if(disabled)event.preventDefault()}}><DashboardIcon name={link.icon}/><span>{link.label}</span></a>)}<div className="rail-note">The proof travels<br/>with the ticket.</div></nav>
}
