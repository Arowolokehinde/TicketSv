import {publicKey,readTicketPackage,readReceiveRequest} from '../tickets/codec.ts'
import type {TicketPackage,ReceiveRequest} from '../tickets/types.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'

// Evidence only: deliberately contains no wallet attempt state or action references.
export type ReopeningEvidence={kind:'counterfoil-reopening-evidence';version:1;trusted:string;pkg:TicketPackage;buyer:ReceiveRequest}
export function readReopeningEvidence(value:unknown):ReopeningEvidence{
 if(!value||typeof value!=='object')throw new Error('Invalid reopening evidence')
 const r=value as ReopeningEvidence
 if(r.kind!=='counterfoil-reopening-evidence'||r.version!==1)throw new Error('Invalid reopening evidence')
 return {kind:r.kind,version:1,trusted:publicKey(r.trusted),pkg:readTicketPackage(JSON.stringify(r.pkg)),buyer:readReceiveRequest(JSON.stringify(r.buyer))}
}
export async function verifyReopeningEvidence(value:unknown,snapshot:HeaderSnapshot|undefined){
 const r=readReopeningEvidence(value)
 return verifyTicket(r.pkg,{trustedVenueIdentity:r.trusted,expectedRequest:r.buyer,snapshot})
}
