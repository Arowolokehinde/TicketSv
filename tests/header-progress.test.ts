import {expect,it,vi} from 'vitest'
import type {Pool} from 'pg'
import {readHeaderProgress} from '../server/header-cache.ts'
import {CHECKPOINT} from '../src/headers/checkpoint.ts'
it('polls only progress metadata, never the retained JSON header history',async()=>{
 const query=vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[{tip:CHECKPOINT.height,target:CHECKPOINT.height,state:'ready',error:null,checked_at:new Date(0)}]}))
 expect(await readHeaderProgress({query} as unknown as Pool)).toMatchObject({tip:CHECKPOINT.height,state:'ready'})
 const sql=query.mock.calls[0][0]
 expect(sql).not.toContain('SELECT *');expect(sql).not.toContain('snapshot');expect(sql).toContain(' AS tip')
})
