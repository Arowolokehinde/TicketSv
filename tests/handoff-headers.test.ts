import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ApiFailure} from '../src/auth/api.ts'
import {CHECKPOINT} from '../src/headers/checkpoint.ts'
const mocks=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),cached:vi.fn(),direct:vi.fn(),fetcher:vi.fn()}))
vi.mock('../src/headers/store.ts',()=>({loadSnapshot:mocks.load,saveSnapshot:mocks.save}))
vi.mock('../src/headers/cached-sync.ts',()=>({SHARED_HEADERS_ENABLED:true,syncCachedHeaders:mocks.cached}))
vi.mock('../src/headers/sync.ts',()=>({syncHeaders:mocks.direct,pacedHeaderFetcher:mocks.fetcher}))
import {prepareHandoffHeaders} from '../src/handoff/headers.ts'
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('navigator',{onLine:true});mocks.direct.mockResolvedValue({snapshot:{id:'saved',headers:[]}})})
afterEach(()=>vi.unstubAllGlobals())
it.each([401,409])('falls back on session failure %s without losing saved evidence',async status=>{
 mocks.cached.mockRejectedValue(new ApiFailure(status,'Session unavailable'))
 await prepareHandoffHeaders(CHECKPOINT.height+1,new AbortController().signal)
 expect(mocks.cached.mock.calls[0][5]).toEqual({useCookieSession:true})
 expect(mocks.direct).toHaveBeenCalledTimes(1)
 expect(mocks.save).toHaveBeenCalledTimes(1)
})
it('does not hide a bad shared header response with a fallback',async()=>{
 mocks.cached.mockRejectedValue(Error('Saved header boundary changed'))
 await expect(prepareHandoffHeaders(CHECKPOINT.height+1,new AbortController().signal)).rejects.toThrow('boundary changed')
 expect(mocks.direct).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled()
})
it('uses complete saved headers offline without contacting the session or providers',async()=>{
 vi.stubGlobal('navigator',{onLine:false})
 const saved={id:'saved',headers:[{height:CHECKPOINT.height+1}]};mocks.load.mockResolvedValue(saved)
 expect(await prepareHandoffHeaders(CHECKPOINT.height+1,new AbortController().signal)).toBe(saved)
 expect(mocks.cached).not.toHaveBeenCalled();expect(mocks.direct).not.toHaveBeenCalled()
})

it('prepares the existing mined transfer beyond the former checkpoint ceiling',async()=>{
 const saved={id:'saved',headers:[{height:1766465}]}
 mocks.load.mockResolvedValueOnce(undefined).mockResolvedValue(saved)
 mocks.cached.mockResolvedValue(saved)
 expect(await prepareHandoffHeaders(1766465,new AbortController().signal)).toBe(saved)
 expect(mocks.cached.mock.calls[0][0]).toBe(1766465)
 expect(mocks.direct).not.toHaveBeenCalled()
})
