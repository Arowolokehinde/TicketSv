// Offline Dashboard is a device library, never a cached authenticated account.
export function offlineDestination(path:string,online:boolean):string {
 const url=new URL(path,'https://ticketsv.invalid')
 if(!online&&(url.pathname==='/'||/^\/(?:tickets|events|venue)(?:\/|$)/.test(url.pathname)))return '/offline/tickets'
 return url.pathname+url.search+url.hash
}
export function localPage(path:string):boolean {
 return /^\/offline\/(?:tickets|handoff)\/?$/.test(path)
}
