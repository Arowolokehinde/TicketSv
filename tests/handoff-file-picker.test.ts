import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
declare global {interface Window {HandoffFileTest:typeof import('./helpers/handoff-file-picker-entry.tsx')}}
let browser:Browser,bundle:string,css:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/handoff-file-picker-entry.tsx'),name:'HandoffFileTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('No picker bundle')
 bundle=result.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n');css=result.output.flatMap(x=>x.type==='asset'&&x.fileName.endsWith('.css')?[String(x.source)]:[]).join('\n')
 browser=await chromium.launch({headless:true})
},15000)
afterAll(async()=>{await browser?.close()})
it.each([false,true])('opens the local picker and loads its file (legacy fallback: %s)',async fallback=>{
 const page=await browser.newPage()
 try{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await page.goto('http://127.0.0.1:4175/offline/handoff?step=send');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await page.evaluate(()=>window.HandoffFileTest.mount())
 if(fallback)await page.evaluate(()=>Object.defineProperty(HTMLInputElement.prototype,'showPicker',{configurable:true,value:undefined}))
 const button=page.getByRole('button',{name:'Choose receiving request file',exact:true});await button.waitFor({timeout:1500})
 const [chooser]=await Promise.all([page.waitForEvent('filechooser',{timeout:1500}),button.click()])
 await chooser.setFiles({name:'receiving-request.json',mimeType:'application/json',buffer:Buffer.from('{"kind":"ticketsv-handoff-request"}')})
 await page.waitForFunction(()=>document.getElementById('result')?.textContent?.includes('ticketsv-handoff-request'))
 expect(await page.locator('#result').textContent()).toContain('ticketsv-handoff-request')
 }finally{await page.close()}
})

it('shows a picker error rather than silently failing when Chrome rejects the request',async()=>{
 const page=await browser.newPage()
 try{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await page.goto('http://127.0.0.1:4175');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle})
 await page.evaluate(()=>{Object.defineProperty(HTMLInputElement.prototype,'showPicker',{configurable:true,value:()=>{throw new DOMException('Picker blocked','NotAllowedError')}});window.HandoffFileTest.mount()})
 await page.getByRole('button',{name:'Choose receiving request file',exact:true}).click()
 expect(await page.getByRole('alert').textContent()).toContain('Picker blocked')
 expect(await page.locator('#result').textContent()).toBe('')
 }finally{await page.close()}
})
