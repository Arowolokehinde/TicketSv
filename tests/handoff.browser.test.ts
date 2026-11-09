import {expect,test} from '@playwright/test'
test('handoff opens without a server session or wallet calls and keeps actions explicit',async({page,context})=>{
 const contacts:string[]=[]
 await context.route('**/api/**',r=>{contacts.push(r.request().url());return r.abort()})
 await context.route('http://localhost:3321/**',r=>{contacts.push(r.request().url());return r.abort()})
 await page.goto('/offline/handoff')
 await expect(page.getByRole('heading',{name:'Transfer a ticket.'})).toBeVisible()
 await expect(page.getByRole('link',{name:'Receive ticket',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'Receive ticket',exact:true}).click()
 await expect(page.getByRole('button',{name:'Choose invitation file',exact:true})).toBeVisible()
 expect(contacts).toEqual([])
 await expect(page.getByRole('button',{name:'Create receiving request',exact:true})).toHaveCount(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('production handoff route reopens from the offline worker without sign-in',async({page,context})=>{
 await page.goto('/offline/handoff')
 await page.evaluate(async()=>{
  const r=await navigator.serviceWorker.register('/attendee-offline-worker.js',{scope:'/offline/'})
  await navigator.serviceWorker.ready
  await new Promise<void>((resolve,reject)=>{const ch=new MessageChannel();ch.port1.onmessage=e=>{ch.port1.close();e.data?.ready?resolve():reject(Error('Cache not ready'))};r.active!.postMessage('PREPARE_ATTENDEE_CACHE',[ch.port2])})
 })
 await page.reload();await context.setOffline(true);await page.close()
 const reopened=await context.newPage(),contacts:string[]=[]
 context.on('request',r=>{if(r.url().includes('/api/')||r.url().includes(':3321'))contacts.push(r.url())})
 await reopened.goto('/offline/handoff');await expect(reopened.getByRole('heading',{name:'Transfer a ticket.'})).toBeVisible()
 await reopened.getByRole('link',{name:'Receive ticket',exact:true}).click();await expect(reopened.getByRole('button',{name:'Choose invitation file',exact:true})).toBeVisible();expect(contacts).toEqual([])
})
