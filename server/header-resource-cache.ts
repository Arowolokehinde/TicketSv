// Only transport bytes are cached; comparison and header validation still run.
export function createHeaderResourceCache(now:()=>number=Date.now,maxBytes=8*1024*1024){
 const entries=new Map<string,{bytes:Uint8Array;expires:number}>();let size=0
 const remove=(key:string)=>{const entry=entries.get(key);if(entry){size-=entry.bytes.length;entries.delete(key)}}
 return {
  clear(){entries.clear();size=0},
  async read(key:string,ttl:number,signal:AbortSignal,load:()=>Promise<Uint8Array>):Promise<Uint8Array>{
   signal.throwIfAborted()
   for(const [key,entry] of entries)if(entry.expires<=now())remove(key)
   const existing=entries.get(key)
   if(existing)return existing.bytes.slice()
   const bytes=await load();signal.throwIfAborted()
   if(ttl>0&&bytes.length<=maxBytes){
    remove(key)
    while(size+bytes.length>maxBytes&&entries.size)remove(entries.keys().next().value!)
    entries.set(key,{bytes:bytes.slice(),expires:now()+ttl});size+=bytes.length
   }
   return bytes
  },
 }
}
