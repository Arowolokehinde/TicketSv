import {useEffect,useState} from 'react'
import {currentAuthIdentity} from '../auth/api.ts'

// Offline routes retain ordinary document navigation and their independent
// service-worker scopes. Only the online account pages share an in-memory app.
function onlinePath(path:string){return path==='/'||/^\/(?:events|tickets|venue)(?:\/|$)/.test(path)}
export function navigateOnline(destination:string):boolean{
 const url=new URL(destination,location.href)
 if(url.origin!==location.origin||!onlinePath(location.pathname)||!onlinePath(url.pathname)||url.hash)return false
 if(url.href!==location.href)history.pushState(null,'',url.href)
 dispatchEvent(new PopStateEvent('popstate'))
 return true
}
export function useAppLocation():string{
 const [address,setAddress]=useState(()=>location.pathname+location.search)
 useEffect(()=>{
  const changed=()=>setAddress(location.pathname+location.search)
  const clicked=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||!currentAuthIdentity())return
   const anchor=event.target instanceof Element?event.target.closest('a'):null
   if(!(anchor instanceof HTMLAnchorElement)||anchor.hasAttribute('download')||anchor.target&&anchor.target!=='_self'||anchor.getAttribute('aria-disabled')==='true'||anchor.rel.split(/\s+/).includes('external'))return
   if(navigateOnline(anchor.href))event.preventDefault()
  }
  addEventListener('popstate',changed);document.addEventListener('click',clicked)
  return()=>{removeEventListener('popstate',changed);document.removeEventListener('click',clicked)}
 },[])
 return address
}
