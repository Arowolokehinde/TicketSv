import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type BrowserContext} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {mkdir} from 'node:fs/promises'
declare global{interface Window{ScannerTest:typeof import('./helpers/scanner-browser-entry.tsx')}}
let browser:Browser,bundle:string,styles:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/scanner-browser-entry.tsx'),name:'ScannerTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built;if(!('output'in result))throw Error('Missing scanner bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n')
 styles=result.output.flatMap(p=>p.type==='asset'&&p.fileName.endsWith('.css')?[String(p.source)]:[]).join('\n')
 browser=await chromium.launch({headless:true})
},30000)
afterAll(async()=>{await browser?.close()})
async function pageFor(context:BrowserContext,seed=true){
 const calls:string[]=[]
 await context.route('**/*',route=>{if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'});calls.push(route.request().url());return route.abort()})
 const page=await context.newPage();await page.goto('https://scanner.example/scanner')
 await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle})
 const pkg=seed?await page.evaluate(()=>window.ScannerTest.seed()):undefined
 await page.evaluate(()=>window.ScannerTest.mount())
 await page.getByRole('heading',{name:seed?'This scanner':'Prepare this scanner',exact:true}).waitFor()
 return {page,calls,pkg}
}
it('imports and rejects fake evidence locally and clears old results on another import',async()=>{
 const context=await browser.newContext();const {page,calls,pkg}=await pageFor(context)
 const upload=async(value:unknown)=>page.getByLabel('Load ticket file',{exact:true}).setInputFiles({name:'synthetic-ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))})
 await upload(pkg);await page.getByRole('button',{name:'Verify locally',exact:true}).click()
 await page.getByRole('heading',{name:'Verification incomplete',exact:true}).waitFor()
 const bad=structuredClone(pkg!);bad.issuance.ticketId='tampered'
 await upload(bad);expect(await page.locator('.scanner-result').count()).toBe(0)
 await page.getByRole('button',{name:'Verify locally',exact:true}).click();await page.getByRole('heading',{name:'Ticket rejected',exact:true}).waitFor()
 expect(await page.locator('.scanner-result').innerText()).toContain('issuer: fail')
 expect(calls).toEqual([]);await context.close()
})
it('restores evidence but recomputes verdicts, and fits narrow screens',async()=>{
 const context=await browser.newContext({viewport:{width:320,height:850}});const {page,pkg,calls}=await pageFor(context)
 await page.getByLabel('Load ticket file',{exact:true}).setInputFiles({name:'ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))})
 await page.getByRole('button',{name:'Verify locally',exact:true}).click();await page.locator('.scanner-result').waitFor()
 await page.evaluate(()=>{window.ScannerTest.unmount();window.ScannerTest.mount()})
 await page.getByRole('button',{name:'Verify locally',exact:true}).waitFor()
 expect(await page.locator('.scanner-result').count()).toBe(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await mkdir('.superpowers/sdd/scanner',{recursive:true})
 await page.screenshot({path:'.superpowers/sdd/scanner/phone.png',fullPage:true})
 expect(calls).toEqual([]);await context.close()
})
it('requires event setup and reports camera denial without requesting a wallet',async()=>{
 let context=await browser.newContext();let state=await pageFor(context,false)
 expect(await state.page.getByRole('button',{name:'Scan ticket QR',exact:true}).isDisabled()).toBe(true)
 await context.close();context=await browser.newContext();state=await pageFor(context)
 await state.page.evaluate(()=>Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new Error('Camera permission denied')}}}))
 await state.page.getByRole('button',{name:'Scan ticket QR',exact:true}).click()
 await state.page.getByRole('alert').filter({hasText:'Camera permission denied'}).waitFor()
 expect(state.calls).toEqual([]);await context.close()
})
