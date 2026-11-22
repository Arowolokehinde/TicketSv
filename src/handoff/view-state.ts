// A navigation preference only. Evidence and durable attempt guards remain in
// their validated IndexedDB records; consent and verification are never saved here.
export type HandoffView={tab:'prepare'|'send'|'receive'|'confirm';source?:string;recipient?:string;settlement?:string}
const key=(receiving:boolean)=>`ticketsv-handoff-view-v1:${receiving?'receive':'send'}`
export function loadHandoffView(receiving:boolean):HandoffView|null {
 try {
  const raw=localStorage.getItem(key(receiving));if(!raw||raw.length>4096)return null
  const v=JSON.parse(raw) as HandoffView
  if(!v||typeof v!=='object'||!(receiving?['receive','confirm']:['prepare','send','confirm']).includes(v.tab))return null
  for(const field of ['source','recipient','settlement'] as const)if(v[field]!==undefined&&(typeof v[field]!=='string'||v[field]!.length>1000))return null
  return {tab:v.tab,source:v.source,recipient:v.recipient,settlement:v.settlement}
 }catch{return null}
}
export function saveHandoffView(receiving:boolean,view:HandoffView):void {
 try{localStorage.setItem(key(receiving),JSON.stringify(view))}catch{/* Optional preference; ticket storage is separate. */}
}
