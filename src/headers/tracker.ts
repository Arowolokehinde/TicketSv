import type { ChainTracker } from '@bsv/sdk'
import { checkedHeader, validateSnapshot } from './validate.ts'
import type { HeaderSnapshot } from './validate.ts'
export class MissingHeaderError extends Error {
 readonly height: number
 constructor(height: number) { super(`HEADER_MISSING: Verification incomplete — required block header missing (${height})`); this.height=height }
}
export function createLocalTracker(value: HeaderSnapshot): ChainTracker {
 const snapshot=validateSnapshot(value)
 const roots=new Map(snapshot.headers.map(h=>[h.height,checkedHeader(h).merkleRoot]))
 return Object.freeze({
  async isValidRootForHeight(root: string,height: number) {
   if(!roots.has(height)) throw new MissingHeaderError(height)
   return roots.get(height)===root
  },
  async currentHeight(){return snapshot.headers[snapshot.headers.length-1].height},
  getVerificationContext:()=>snapshot.id,
  async getVerificationContextToken(){return snapshot.id},
 })
}
