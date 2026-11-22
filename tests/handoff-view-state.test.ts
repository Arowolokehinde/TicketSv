import {afterEach,expect,it,vi} from 'vitest'
import {loadHandoffView,saveHandoffView} from '../src/handoff/view-state.ts'
afterEach(()=>vi.unstubAllGlobals())
it('keeps sender and recipient navigation separate and ignores malformed or unavailable preference storage',()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)})
 saveHandoffView(false,{tab:'send',source:'source-output'});saveHandoffView(true,{tab:'receive',recipient:'independent-request'})
 expect(loadHandoffView(false)).toEqual({tab:'send',source:'source-output'})
 expect(loadHandoffView(true)).toEqual({tab:'receive',recipient:'independent-request'})
 values.set('ticketsv-handoff-view-v1:receive',JSON.stringify({tab:'send',source:'other'}));expect(loadHandoffView(true)).toBeNull()
 values.set('ticketsv-handoff-view-v1:send','bad json');expect(loadHandoffView(false)).toBeNull()
 vi.stubGlobal('localStorage',{getItem:()=>{throw Error('Blocked')},setItem:()=>{throw Error('Blocked')}})
 expect(loadHandoffView(false)).toBeNull();expect(()=>saveHandoffView(false,{tab:'send'})).not.toThrow()
})
