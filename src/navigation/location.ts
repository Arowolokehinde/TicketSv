import {useEffect,useState} from 'react'
import {localPage,offlineDestination} from './offline.ts'
import {currentAuthIdentity} from '../auth/api.ts'

// Keep prepared offline pages in the current document, including browsers
// without service workers. Service-worker scopes still govern cold reopening.
function onlinePath(path:string){return path==='/'||/^\/(?:events|tickets|venue)(?:\/|$)/.test(path)}
export function navigateOnline(destination:string):boolean{
 const url=new URL(destination,location.href)
 if(url.origin!==location.origin||url.hash)return false
 const destinationPath=offlineDestination(url.pathname+url.search,navigator.onLine)
 const target=new URL(destinationPath,location.origin)
 const local=localPage(target.pathname)||/^\/scanner(?:\/prepare)?\/?$/.test(target.pathname)
 if(!local&&(!navigator.onLine||!currentAuthIdentity()||!onlinePath(target.pathname)||!(onlinePath(location.pathname)||localPage(location.pathname))))return false
 if(!localPage(location.pathname)&&!onlinePath(location.pathname)&&!local)return false
 url.pathname=target.pathname;url.search=target.search
 if(url.href!==location.href)history.pushState(null,'',url.href)
 dispatchEvent(new PopStateEvent('popstate'))
 return true
}
export function useAppLocation():string{
 const [address,setAddress]=useState(()=>location.pathname+location.search)
 const [,setConnected]=useState(navigator.onLine)
 useEffect(()=>{
  const changed=()=>setAddress(location.pathname+location.search)
  const connectivity=()=>{setConnected(navigator.onLine);if(!navigator.onLine&&/^\/tickets\/?$/.test(location.pathname))navigateOnline('/offline/tickets')}
  const clicked=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return
   const anchor=event.target instanceof Element?event.target.closest('a'):null
   if(!(anchor instanceof HTMLAnchorElement)||anchor.hasAttribute('download')||anchor.target&&anchor.target!=='_self'||anchor.getAttribute('aria-disabled')==='true'||anchor.rel.split(/\s+/).includes('external'))return
   const url=new URL(anchor.href)
   if(!navigator.onLine&&url.origin===location.origin&&!url.hash&&onlinePath(url.pathname)&&!/^\/tickets\/?$/.test(url.pathname)){
    event.preventDefault();dispatchEvent(new Event('ticketsv-offline-navigation'));return
   }
   if(navigateOnline(anchor.href))event.preventDefault()
  }
  addEventListener('popstate',changed);addEventListener('offline',connectivity);addEventListener('online',connectivity);document.addEventListener('click',clicked)
  return()=>{removeEventListener('popstate',changed);removeEventListener('offline',connectivity);removeEventListener('online',connectivity);document.removeEventListener('click',clicked)}
 },[])
 return address
}
