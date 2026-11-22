import {expect,it} from 'vitest'
import {createRateLimiter} from '../server/rate-limit.ts'

function limiter(maxKeys=10_000){let time=1_000_000;const allow=createRateLimiter({limit:120,windowMs:60_000,maxKeys,now:()=>time});return {allow,advance:(ms:number)=>{time+=ms}}}
it('counts separate clients independently',()=>{
 const {allow}=limiter()
 for(let i=0;i<120;i++)expect(allow('203.0.113.1')).toBe(true)
 expect(allow('203.0.113.1')).toBe(false)
 expect(allow('198.51.100.7')).toBe(true)
})
it('opens a new window after sixty seconds',()=>{
 const {allow,advance}=limiter()
 for(let i=0;i<121;i++)allow('203.0.113.1')
 expect(allow('203.0.113.1')).toBe(false)
 advance(60_000)
 expect(allow('203.0.113.1')).toBe(true)
})
it('refuses new keys at the cap while existing keys keep counting',()=>{
 const {allow}=limiter(2)
 expect(allow('a')).toBe(true);expect(allow('b')).toBe(true)
 expect(allow('c')).toBe(false)
 expect(allow('a')).toBe(true)
})
