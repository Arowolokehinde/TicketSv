import type {ReopeningEvidence} from '../offline/evidence.ts'
export const ARC_TESTNET='https://arcade-v2-testnet-us-1.bsvblockchain.tech' as const
export type ArcPolicy={maxTxBytes:number;feeSatoshis:number;feeBytes:number}
export type ArcObservation={txid:string;txStatus:string;observedAt:string;blockHash?:string;blockHeight?:number;merklePath?:string;competingTxs?:string[]}
export type TransferReview={txid:string;rawHex:string;efHex:string;fee:number;rawBytes:number;inputs:{txid:string;index:number;satoshis:number}[];outputs:{index:number;satoshis:number}[];evidence:ReopeningEvidence;snapshotId:string}
export type SubmissionAttempt={id:string;startedAt:string;finishedAt?:string;outcome:'pending'|'response'|'unknown';observation?:ArcObservation;error?:string}
export type StatusCheck={checkedAt:string;observation?:ArcObservation}
export type SettlementRecord={version:1;txid:string;revision:number;provider:typeof ARC_TESTNET;evidence:ReopeningEvidence;rawHex:string;efHex:string;attempts:SubmissionAttempt[];statusChecks:StatusCheck[];retryBlockedBy?:string;lastStatus?:ArcObservation;candidate?:ReopeningEvidence;reconciledAttemptId?:string;lastStatusCheckedAt?:string}
