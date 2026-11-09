import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type Page} from '@playwright/test'
import {readFile} from 'node:fs/promises'
let browser:Browser,html:string
beforeAll(async()=>{html=await readFile('public/refresh-offline.html','utf8');browser=await chromium.launch({headless:true})})
afterAll(async()=>{await browser?.close()})
async function mount(page:Page,waiting=true){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(waiting=>{
  const worker=new EventTarget() as EventTarget&{state:string};worker.state='installed';Object.assign(worker,{scriptURL:location.origin+'/attendee-offline-worker.js'})
  const registration={scope:location.origin+'/offline/',active:{scriptURL:location.origin+'/attendee-offline-worker.js'},waiting:waiting?worker:null,installing:null,update:async()=>{}}
  Object.assign(window,{activateTestUpdate:()=>{worker.state='activated';registration.waiting=null;worker.dispatchEvent(new Event('statechange'))}})
  Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>registration}})
 },waiting)
 await page.goto('http://127.0.0.1:4175/refresh-offline.html')
 await page.evaluate(()=>localStorage.setItem('test-ticket-evidence','retain'))
}
it('waits for old offline tabs to close, never forces activation, and keeps saved data',async()=>{
 const page=await browser.newPage()
 try{
 await mount(page)
 await page.getByRole('button',{name:'Check for app update',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Close your other TicketSV tabs'}).waitFor({timeout:1500})
 expect(await page.getByRole('link',{name:'Return to Send',exact:true}).isVisible()).toBe(false)
 await page.evaluate(()=>(window as unknown as {activateTestUpdate:()=>void}).activateTestUpdate())
 await page.getByRole('link',{name:'Return to Send',exact:true}).waitFor()
 expect(await page.evaluate(()=>localStorage.getItem('test-ticket-evidence'))).toBe('retain')
 }finally{await page.close()}
})
it('returns to the same-origin Send flow when the offline installation is already current',async()=>{
 const page=await browser.newPage()
 try{
 await mount(page,false);await page.getByRole('button',{name:'Check for app update',exact:true}).click()
 const link=page.getByRole('link',{name:'Return to Send',exact:true});await link.waitFor()
 expect(await link.getAttribute('href')).toBe('/offline/handoff?step=send')
 }finally{await page.close()}
})
