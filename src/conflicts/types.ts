import type {ReopeningEvidence} from '../offline/evidence.ts'
import type {Verification} from '../tickets/types.ts'
import type {TransferReview} from '../settlement/types.ts'
export type ConflictBranch='a'|'b'
export type ConflictPair={a:ReopeningEvidence;b:ReopeningEvidence}
export type ConflictPairReview={verdict:Verification['verdict'];reason:string;sharedTicket?:string;snapshotId?:string;checks:Record<ConflictBranch,Verification>;reviews:Partial<Record<ConflictBranch,Omit<TransferReview,'snapshotId'>>>}
export type ConflictVerdict={verdict:'incomplete'|'rejected'|'conflicting-spend-mined-in-local-snapshot';reason:string;winner?:string;loser?:string;snapshotId?:string}
