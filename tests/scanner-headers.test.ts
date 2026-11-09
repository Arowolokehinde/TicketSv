import {afterEach,expect,it,vi} from 'vitest'
import {prepareScannerHeaders} from '../src/scanner/headers.ts'
import * as store from '../src/headers/store.ts'
import {CHECKPOINT} from '../src/headers/checkpoint.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
const records=[a,b].map(h=>parseProviderHeader(h,'whatsonchain',h.height))
const status={network:'testnet',checkpoint:CHECKPOINT,tip:b.height,target:b.height,state:'ready'}
afterEach(()=>vi.restoreAllMocks())
function range(corrupt=false){const bytes=Buffer.from(records.map(h=>h.hex).join(''),'hex');if(corrupt)bytes[90]^=1;return new Response(bytes,{headers:{'X-TicketSV-Header-Start':String(a.height),'X-TicketSV-Header-Count':'2','X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':CHECKPOINT.hash,'X-TicketSV-Header-Comparison':'server-reported'}})}
it('downloads available public batches read-only, validates and persists progress',async()=>{
 vi.spyOn(store,'loadSnapshot').mockResolvedValue(undefined)
 const save=vi.spyOn(store,'saveSnapshot').mockResolvedValue()
 const get=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>String(path).includes('/status')?Response.json(status):range())
 const snapshot=await prepareScannerHeaders(new AbortController().signal)
 expect(snapshot.headers).toHaveLength(2);expect(save).toHaveBeenCalledTimes(1)
 expect(get.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true)
 expect(get.mock.calls.some(([path])=>String(path).includes('header-preparation'))).toBe(false)
})
it('reuses saved coverage and never replaces it with a shorter shared snapshot',async()=>{
 const existing=makeSnapshot(records);vi.spyOn(store,'loadSnapshot').mockResolvedValue(existing)
 const save=vi.spyOn(store,'saveSnapshot').mockResolvedValue()
 const get=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...status,tip:a.height}))
 expect(await prepareScannerHeaders(new AbortController().signal)).toBe(existing)
 expect(get).toHaveBeenCalledTimes(1);expect(save).not.toHaveBeenCalled()
})
it('rejects corrupt batches and blocked source history without saving replacements',async()=>{
 vi.spyOn(store,'loadSnapshot').mockResolvedValue(undefined);const save=vi.spyOn(store,'saveSnapshot').mockResolvedValue()
 const get=vi.spyOn(globalThis,'fetch').mockImplementation(async path=>String(path).includes('/status')?Response.json(status):range(true))
 await expect(prepareScannerHeaders(new AbortController().signal)).rejects.toThrow();expect(save).not.toHaveBeenCalled()
 get.mockResolvedValue(Response.json({...status,state:'blocked'}))
 await expect(prepareScannerHeaders(new AbortController().signal)).rejects.toThrow(/review/)
})
