import {expect,it,vi} from 'vitest'
import type {Pool} from 'pg'
import {hostedConfig} from '../server/hosted-config.ts'
import {hostedHeaderResumer} from '../server/hosted-headers.ts'

const env={DATABASE_URL:'postgres://user:password@db.example/ticketsv',AUTH_SERVER_PRIVATE_KEY:'01'.padStart(64,'0'),APP_ORIGINS:'https://ticketsv.example'}
it('requires exact HTTPS origins, valid service identity and a dedicated remote database',()=>{
 expect(hostedConfig(env)).toMatchObject({connectionString:env.DATABASE_URL,origins:['https://ticketsv.example']})
 for(const patch of [{DATABASE_URL:''},{DATABASE_URL:'postgres://localhost/ticketsv'},{APP_ORIGINS:'*'},{APP_ORIGINS:'http://ticketsv.example'},{APP_ORIGINS:'https://ticketsv.example/path'},{AUTH_SERVER_PRIVATE_KEY:'0'.repeat(64)},{AUTH_SERVER_PRIVATE_KEY:'f'.repeat(64)}])expect(()=>hostedConfig({...env,...patch})).toThrow()
 expect(hostedConfig({...env,DATABASE_URL_UNPOOLED:'postgres://direct.example/ticketsv'}).connectionString).toContain('direct.example')
})
it('coalesces work in an instance and runs bounded missing batches after responding',async()=>{
 let finish!:(value:never)=>void
 const first=new Promise<never>(resolve=>{finish=resolve}),collect=vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({tip:20,target:20,state:'ready'})
 const tasks:Promise<unknown>[]=[]
 const resume=hostedHeaderResumer({} as Pool,p=>tasks.push(p),collect)
 resume();resume();expect(tasks).toHaveLength(1)
 finish({tip:10,target:20,state:'queued'} as never)
 await tasks[0];expect(collect).toHaveBeenCalledTimes(2)
})
it('stops on blocked, retrying or unchanged work and retains the shared cache',async()=>{
 for(const state of ['blocked','retrying','collecting']){
  const tasks:Promise<unknown>[]=[],collect=vi.fn().mockResolvedValue({tip:10,target:20,state})
  const resume=hostedHeaderResumer({} as Pool,p=>tasks.push(p),collect)
  resume();await tasks[0];expect(collect).toHaveBeenCalledTimes(state==='collecting'?2:1)
 }
})
