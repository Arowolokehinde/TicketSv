import {expect,it,vi} from 'vitest'
import type {Express} from 'express'
import type {Pool} from 'pg'
import {marketplaceRoutes} from '../server/marketplace.ts'

it('lists published events without excluding past dates and returns their request eligibility',async()=>{
 const routes=new Map<string,Function>()
 const app={get:(path:string,handler:Function)=>routes.set(path,handler),post:()=>{}} as unknown as Express
 const row={event_id:'b54a41c1-e532-42d4-8f86-04f91c547d73',revision:1,owner_key:'venue',details:{name:'Madrid',date:'2026-10-30'},requests_open:false}
 const query=vi.fn().mockResolvedValue({rows:[row]})
 marketplaceRoutes(app,{query} as unknown as Pool,()=>1793664000000)
 const json=vi.fn()
 await routes.get('/api/marketplace/events')!({query:{}},{json})
 const [sql,params]=query.mock.calls[0]
 expect(sql).toContain('WHERE published ORDER BY')
 expect(sql).toContain('AS requests_open')
 expect(params).toEqual([1793664000000,0])
 expect(json.mock.calls[0][0].events[0]).toMatchObject({name:'Madrid',requestsOpen:false})
})
