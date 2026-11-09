import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type Page} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
declare global {interface Window {HeaderStoreTest:typeof import('./helpers/header-store-browser-entry.ts')}}
const records=[a,b].map(h=>parseProviderHeader(h,'whatsonchain',h.height))
let browser:Browser,bundle:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/header-store-browser-entry.ts'),name:'HeaderStoreTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing test bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n')
 browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
async function mount(page:Page){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Header storage tests</title>'}))
 await page.goto('http://ticketsv-storage.test/')
 await page.addScriptTag({content:bundle})
}
it('migrates legacy headers on save and commits chunks with metadata atomically',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await mount(page)
 try{
 const legacy=makeSnapshot([records[0]])
 const result=await page.evaluate(async({legacy,records})=>{
  const api=window.HeaderStoreTest
  await new Promise<void>((resolve,reject)=>{
   const request=indexedDB.open(api.HEADER_DB,1)
   request.onupgradeneeded=()=>request.result.createObjectStore('snapshots')
   request.onerror=()=>reject(request.error)
   request.onsuccess=()=>{const db=request.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(legacy,'accepted');tx.oncomplete=()=>{db.close();resolve()}}
  })
  const loaded=await api.loadSnapshot(),next=api.appendSnapshot(loaded,[records[1]])
  await api.saveSnapshot(next,undefined,{id:loaded!.id})
  const stored=await api.loadSnapshot()
  const structure=await new Promise<{chunked:boolean;chunks:number;version:number}>((resolve)=>{
   const r=indexedDB.open(api.HEADER_DB);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('chunks')){resolve({chunked:false,chunks:0,version:db.version});db.close();return}const tx=db.transaction(['snapshots','chunks'],'readonly'),meta=tx.objectStore('snapshots').get('accepted'),chunks=tx.objectStore('chunks').count();tx.oncomplete=()=>{resolve({chunked:!meta.result.headers,chunks:chunks.result,version:db.version});db.close()}}
  })
  return {id:stored!.id,headers:stored!.headers,structure}
 },{legacy,records})
 expect(result.id).toBe(makeSnapshot(records).id)
 expect(result.headers).toEqual(records)
 expect(result.structure).toEqual({chunked:true,chunks:1,version:2})
 }finally{await context.close()}
})
it('retains committed progress on cancellation and concurrent saves, including provenance',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await mount(page)
 try{
 const result=await page.evaluate(async(records)=>{
  const api=window.HeaderStoreTest,first=api.makeSnapshot([records[0]])
  await api.saveSnapshot(first,undefined,{id:undefined})
  const recheck=await api.loadSnapshotForRecheck()
  const shared=api.appendSnapshot(first,[records[1]],undefined,'ticketsv-cache')
  await api.saveSnapshot(shared,undefined,{id:first.id})
  let conflict=false,cancelled=false,exactConflict=false
  try{await api.saveSnapshot(first,undefined,{id:first.id})}catch{conflict=true}
  const abort=new AbortController();abort.abort(Error('cancel'))
  try{await api.saveSnapshot(first,abort.signal,{id:shared.id})}catch{cancelled=true}
  try{await api.saveSnapshot(first,undefined,recheck.expected)}catch{exactConflict=true}
  // Same bytes from a different source must not silently clear server provenance.
  await api.saveSnapshot(api.makeSnapshot(records),undefined,{id:shared.id})
  const saved=await api.loadSnapshot()
  return {conflict,cancelled,exactConflict,source:saved!.source,length:saved!.headers.length}
 },records)
 expect(result).toEqual({conflict:true,cancelled:true,exactConflict:true,source:'ticketsv-cache',length:2})
 }finally{await context.close()}
})
it('rolls back both chunks and metadata when cancellation or a write failure interrupts an append',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await mount(page)
 try{
 const result=await page.evaluate(async(records)=>{
  const api=window.HeaderStoreTest,first=api.makeSnapshot([records[0]])
  await api.saveSnapshot(first,undefined,{id:undefined})
  const next=api.appendSnapshot(first,[records[1]]),original=IDBObjectStore.prototype.put
  const controller=new AbortController();let cancelled=false,failed=false
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
   const request=original.apply(this,args)
   if(this.name==='chunks')controller.abort(Error('cancel during chunk write'))
   return request
  }
  try{await api.saveSnapshot(next,controller.signal,{id:first.id})}catch{cancelled=true}
  finally{IDBObjectStore.prototype.put=original}
  const afterCancel=await api.loadSnapshot()
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
   if(this.name==='snapshots')throw Error('metadata write unavailable')
   return original.apply(this,args)
  }
  try{await api.saveSnapshot(next,undefined,{id:first.id})}catch{failed=true}
  finally{IDBObjectStore.prototype.put=original}
  const afterFailure=await api.loadSnapshot()
  const writes=await Promise.allSettled([api.saveSnapshot(next,undefined,{id:first.id}),api.saveSnapshot(next,undefined,{id:first.id})])
  return {cancelled,failed,afterCancel:afterCancel!.id,afterFailure:afterFailure!.id,expected:first.id,fulfilled:writes.filter(r=>r.status==='fulfilled').length,rejected:writes.filter(r=>r.status==='rejected').length,length:(await api.loadSnapshot())!.headers.length}
 },records)
 expect(result.cancelled).toBe(true);expect(result.failed).toBe(true)
 expect(result.afterCancel).toBe(result.expected);expect(result.afterFailure).toBe(result.expected)
 expect(result.fulfilled).toBe(1);expect(result.rejected).toBe(1);expect(result.length).toBe(2)
 }finally{await context.close()}
})
it('rejects corrupt chunks and protects explicit recovery against another save',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await mount(page)
 try{
 const result=await page.evaluate(async(records)=>{
  const api=window.HeaderStoreTest,snapshot=api.makeSnapshot(records)
  await api.saveSnapshot(snapshot,undefined,{id:undefined})
  await new Promise<void>(resolve=>{
   const r=indexedDB.open(api.HEADER_DB);r.onsuccess=()=>{const db=r.result,tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put([{...records[0],hex:'00'.repeat(80)},records[1]],0);tx.oncomplete=()=>{db.close();resolve()}}
  })
  let rejected=false,conflict=false
  try{await api.loadSnapshot()}catch{rejected=true}
  const recovery=await api.loadSnapshotForRecheck()
  // A concurrent save repairs the bytes; an earlier recovery token cannot erase it.
  await api.saveSnapshot(snapshot,undefined,{id:snapshot.id})
  try{await api.saveSnapshot(api.makeSnapshot([records[0]]),undefined,recovery.expected)}catch{conflict=true}
  return {rejected,incomplete:recovery.snapshot===undefined,conflict,id:(await api.loadSnapshot())!.id}
 },records)
 expect(result).toEqual({rejected:true,incomplete:true,conflict:true,id:makeSnapshot(records).id})
 }finally{await context.close()}
})
