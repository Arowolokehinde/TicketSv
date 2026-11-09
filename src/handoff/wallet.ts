import { LockingScript, MerklePath, OP, PushDrop, Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import { fromBase64, publicKey, readTicketPackage } from '../tickets/codec.ts'
import { RECEIVE_PROTOCOL, type KeyBinding } from '../tickets/types.ts'
import { ticketScript } from '../tickets/script.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { checkPolicy, parseObservation, parsePolicy } from '../settlement/arc.ts'
import { verifyMiningAnchor } from '../settlement/evidence.ts'
import type { ArcObservation, ArcPolicy } from '../settlement/types.ts'
import { readSigningEvidenceBytes, verifySigningEvidence } from '../verification/signing-spv.ts'
import { waitImport } from '../wallet/mined-import.ts'
import { HANDOFF_PROTOCOL, type Funding, type HandoffRequest, type HandoffTicket, type Invitation, type RecordStore, type SenderRecord } from './types.ts'
import { invitationFor, readHandoffRequest, readHandoffTicket, readInvitation, requestBytes, verifyHandoffTicket } from './evidence.ts'

import { readSender, sourceKey } from './store.ts'

type Reader = Pick<WalletInterface, 'getNetwork' | 'getPublicKey'>
type Signer = Reader & Pick<WalletInterface, 'createSignature'>
type Funder = Reader & Pick<WalletInterface, 'listOutputs' | 'createAction'>
export type FundingReview = Funding & { ticket: HandoffTicket; snapshot: HeaderSnapshot }
export const FUNDING_BASKET = 'ticketsv-handoff-fees'
export const FUNDING_PROTOCOL: [2, string] = [2, 'ticketsv handoff fees']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
async function read<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
 const value = await waitImport(work, signal); signal.throwIfAborted(); return value
}
async function identity(wallet: Reader, expected: string | undefined, signal: AbortSignal): Promise<string> {
 if ((await read(() => wallet.getNetwork({}), signal)).network !== 'testnet') throw Error('Select testnet in your wallet.')
 const actual = publicKey((await read(() => wallet.getPublicKey({ identityKey: true }), signal)).publicKey)
 if (expected && actual !== expected) throw Error('Wallet identity does not match the ticket holder.')
 return actual
}
async function keyMatches(wallet: Reader, key: KeyBinding, signal: AbortSignal): Promise<void> {
 if ((await read(() => wallet.getPublicKey({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, forSelf: true }), signal)).publicKey !== key.publicKey) throw Error('Wallet receiving key changed or does not match.')
}
export async function checkHolder(wallet: Reader, value: HandoffTicket, signal: AbortSignal): Promise<void> {
 const ticket = readHandoffTicket(value)
 await identity(wallet, ticket.holder, signal)
 await keyMatches(wallet, ticket.pkg.request.recipient, signal)
 await identity(wallet, ticket.holder, signal)
}
export async function createReceivingRequest(wallet: Signer, value: Invitation, signal: AbortSignal): Promise<HandoffRequest> {
 const invitation = readInvitation(value), recipientIdentity = await identity(wallet, undefined, signal), requestId = crypto.randomUUID()
 const binding = { protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self' }
 const key = publicKey((await read(() => wallet.getPublicKey({ ...binding, forSelf: true }), signal)).publicKey)
 const request: HandoffRequest['request'] = { kind: 'ticket-request', version: 1, network: 'testnet', requestId, recipient: { ...binding, publicKey: key } }
 const context = { invitation, recipientIdentity, request }, data = requestBytes(context)
 const fresh = async () => { await identity(wallet, recipientIdentity, signal); await keyMatches(wallet, request.recipient, signal); await identity(wallet, recipientIdentity, signal) }
 await fresh()
 const keySignature = Utils.toBase64((await read(() => wallet.createSignature({ ...binding, data }), signal)).signature)
 await fresh()
 const identitySignature = Utils.toBase64((await read(() => wallet.createSignature({ protocolID: HANDOFF_PROTOCOL, keyID: requestId, counterparty: 'anyone', data }), signal)).signature)
 await fresh()
 return readHandoffRequest({ kind: 'ticketsv-handoff-request', version: 1, ...context, keySignature, identitySignature })
}

function budget(value: ArcPolicy): { amount: number; policy: ArcPolicy } {
 const policy = parsePolicy({ policy: { maxtxsizepolicy: value.maxTxBytes, miningFee: { satoshis: value.feeSatoshis, bytes: value.feeBytes } } })
 if (policy.maxTxBytes < 4096) throw Error('Provider size policy cannot support the 4096-byte budget.')
 const cost = (4096n * BigInt(policy.feeSatoshis) + BigInt(policy.feeBytes) - 1n) / BigInt(policy.feeBytes)
 if (cost > 1000n) throw Error('The fee budget exceeds the 1000-satoshi cap.')
 return { amount: Math.max(1, Number(cost)), policy }
}
function feeScript(key: KeyBinding): LockingScript {
 return new LockingScript().writeBin(Utils.toArray(publicKey(key.publicKey), 'hex')).writeOpCode(OP.OP_CHECKSIG)
  .writeBin(Utils.toArray(JSON.stringify(['ticketsv-handoff-fee', 1, 'testnet', key.keyID]), 'utf8')).writeOpCode(OP.OP_DROP) as LockingScript
}
async function minedTicket(ticket: HandoffTicket, snapshot: HeaderSnapshot | undefined): Promise<void> {
 const report = await verifyHandoffTicket(ticket, snapshot)
 if (report.verdict !== 'verified' || !report.presentedTransferMined) throw Error('A locally verified mined ticket is required: ' + report.checks.filter(c => c.status !== 'pass').map(c => c.reason).join('; '))
}
async function walletRecord(wallet: Funder, ticket: HandoffTicket, signal: AbortSignal): Promise<void> {
 await checkHolder(wallet, ticket, signal)
 const listing = await read(() => wallet.listOutputs({ basket: 'ticketsv-tickets', include: 'locking scripts', includeCustomInstructions: true, limit: 1000 }), signal)
 await checkHolder(wallet, ticket, signal)
 if (!Number.isSafeInteger(listing.totalOutputs) || listing.totalOutputs < 0 || listing.totalOutputs > 1000 || listing.outputs.length !== listing.totalOutputs || new Set(listing.outputs.map(o => o.outpoint)).size !== listing.outputs.length) throw Error('Wallet ticket listing is incomplete.')
 const matching = listing.outputs.filter(o => o.outpoint === `${ticket.pkg.current.txid}.${ticket.pkg.current.index}`)
 const output = Transaction.fromAtomicBEEF(fromBase64(ticket.pkg.atomicBeefBase64)).outputs[ticket.pkg.current.index], key = ticket.pkg.request.recipient
 const match = matching[0]
 if (matching.length !== 1 || match.spendable !== true || match.satoshis !== 1 || match.lockingScript !== output.lockingScript.toHex() || typeof match.customInstructions !== 'string' || match.customInstructions.length > 10000) throw Error('A matching spendable ticket record is required in the wallet.')
 const instructions = JSON.parse(match.customInstructions)
 if (instructions.type !== 'PushDrop' || instructions.keyID !== key.keyID || instructions.counterparty !== key.counterparty || !same(instructions.protocolID, key.protocolID)) throw Error('Wallet ticket key instructions do not match.')
}
export async function reviewFunding(value: HandoffTicket, policy: ArcPolicy, wallet: Funder, signal: AbortSignal, snapshot: HeaderSnapshot | undefined): Promise<FundingReview> {
 const ticket = readHandoffTicket(value), cost = budget(policy)
 await minedTicket(ticket, snapshot)
 if (!snapshot) throw Error('Local headers required.')
 await walletRecord(wallet, ticket, signal)
 const binding = { protocolID: FUNDING_PROTOCOL, keyID: sourceKey(ticket), counterparty: 'self' }
 const key = { ...binding, publicKey: publicKey((await read(() => wallet.getPublicKey({ ...binding, forSelf: true }), signal)).publicKey) }
 await checkHolder(wallet, ticket, signal)
 await keyMatches(wallet, key, signal)
 return { ...cost, key, ticket, snapshot: structuredClone(snapshot) }
}
async function freshRecord(record: SenderRecord, store: RecordStore<SenderRecord>): Promise<void> {
 if (record.id !== sourceKey(record.ticket)) throw Error('Source record identity changed.')
 const current = await store.load(record.id)
 if (!current || !same(readSender(current), readSender(record))) throw Error('Saved source record changed; review again.')
}
async function write(store: RecordStore<SenderRecord>, current: SenderRecord, patch: Partial<SenderRecord>): Promise<SenderRecord> {
 const next = readSender({ ...current, ...patch, revision: current.revision + 1 }, current)
 await store.save(next, current.revision)
 return next
}
async function finish(store: RecordStore<SenderRecord>, id: string, attemptId: string, field: 'fundAttempt' | 'signAttempt', outcome: 'complete' | 'unknown', patch: Partial<SenderRecord> = {}): Promise<SenderRecord> {
 let current = await store.load(id)
 for (let tries = 0; tries < 3; tries++) {
  if (!current || current[field]?.id !== attemptId) throw Error('The durable source claim changed.')
  // Another local completion is authoritative; terminal outcomes never reverse.
  if (current[field]!.outcome !== 'pending') return current
  const merged = { ...patch, ...(patch.funding ? { funding: { ...current.funding, ...patch.funding } } : {}) }
  try {
   return await write(store, current, { ...merged, [field]: { ...current[field], outcome, finishedAt: new Date().toISOString() } })
  } catch (error) {
   const latest = await store.load(id)
   if (!latest || latest[field]?.id !== attemptId) throw Error('The durable source claim changed.')
   if (latest[field]!.outcome !== 'pending') return latest
   if (latest.revision === current.revision || tries === 2) throw error
   current = latest
  }
 }
 throw Error('The handoff outcome could not be saved; reload the durable claim.')
}
// A cancellation finish can advance the same record while the wallet response is
// being saved. Retry only this immutable local append, never the wallet action.
async function appendFundingReceipt(store: RecordStore<SenderRecord>, id: string, attemptId: string, receipt: unknown): Promise<void> {
 let current = await store.load(id)
 for (let tries = 0; tries < 3; tries++) {
  if (!current?.funding || current.fundAttempt?.id !== attemptId) throw Error('Funding claim changed.')
  if (current.funding.rawReceipt !== undefined) {
   if (!same(current.funding.rawReceipt, receipt)) throw Error('The saved funding receipt cannot be replaced.')
   return
  }
  try {
   await write(store, current, { funding: { ...current.funding, rawReceipt: receipt } })
   return
  } catch (error) {
   const latest = await store.load(id)
   if (!latest || latest.fundAttempt?.id !== attemptId) throw Error('Funding claim changed.')
   // An unchanged revision indicates a storage/validation failure, not contention.
   if (latest.revision === current.revision || tries === 2) throw error
   current = latest
  }
 }
}
function fundingTx(funding: Funding): Transaction {
 if (!funding.txid || !funding.beef || !Number.isSafeInteger(funding.index) || funding.index! < 0) throw Error('Complete funding receipt required.')
 const evidence = readSigningEvidenceBytes(funding.txid, fromBase64(funding.beef))
 const tx = Transaction.fromAtomicBEEF([...evidence.atomicBeef]), output = tx.outputs[funding.index!]
 if (!output || output.satoshis !== funding.amount || output.lockingScript.toHex() !== feeScript(funding.key).toHex()) throw Error('Funding output amount or script does not match.')
 if (tx.outputs.filter(o => o.lockingScript.toHex() === feeScript(funding.key).toHex()).length !== 1) throw Error('Duplicated funding output.')
 return tx
}
export async function fundHandoff(record: SenderRecord, review: FundingReview, wallet: Funder, signal: AbortSignal, store: RecordStore<SenderRecord>): Promise<SenderRecord> {
 record = readSender(record)
 review = structuredClone(review)
 await freshRecord(record, store)
 if (record.fundAttempt || record.signAttempt || record.funding) throw Error('Funding was already attempted; no automatic retry is available.')
 if (!same(readHandoffTicket(record.ticket), review.ticket)) throw Error('Reviewed ticket evidence changed.')
 const rechecked = await reviewFunding(record.ticket, review.policy, wallet, signal, review.snapshot)
 if (rechecked.amount !== review.amount || !same(rechecked.key, review.key)) throw Error('Reviewed fee amount or wallet key changed.')
 const funding: Funding = { amount: review.amount, key: structuredClone(review.key), policy: structuredClone(review.policy) }
 const attempt = { id: crypto.randomUUID(), outcome: 'pending' as const, startedAt: new Date().toISOString() }
 signal.throwIfAborted()
 await write(store, record, { funding, fundAttempt: attempt })
 try {
  await checkHolder(wallet, record.ticket, signal)
  await keyMatches(wallet, funding.key, signal)
  await minedTicket(record.ticket, review.snapshot)
  signal.throwIfAborted()
  // The callback persists a late receipt even when cancellation already ended the UI wait.
  const work = async () => {
   const receipt = await wallet.createAction({ description: 'Prepare TicketSV handoff fee output', outputs: [{ satoshis: funding.amount, lockingScript: feeScript(funding.key).toHex(), outputDescription: 'Dedicated fee for one offline ticket handoff', basket: FUNDING_BASKET, customInstructions: JSON.stringify({ protocolID: funding.key.protocolID, keyID: funding.key.keyID, counterparty: funding.key.counterparty, type: 'PushDrop' }) }], options: { noSend: false, acceptDelayedBroadcast: false, returnTXIDOnly: false, randomizeOutputs: false } })
   await appendFundingReceipt(store, record.id, attempt.id, receipt)
   signal.throwIfAborted()
   if (receipt.signableTransaction || !receipt.txid || !receipt.tx) throw Error('Wallet did not return a final funded transaction.')
   const tx = Transaction.fromAtomicBEEF(receipt.tx)
   const indices = tx.outputs.flatMap((o, i) => o.lockingScript.toHex() === feeScript(funding.key).toHex() ? [i] : [])
   if (indices.length !== 1) throw Error('Dedicated funding output missing or duplicated.')
   const checked = { ...funding, rawReceipt: receipt, txid: receipt.txid, beef: Utils.toBase64(receipt.tx), index: indices[0] }
   const validated = fundingTx(checked)
   if (validated.inputs.some(i => (i.sourceTXID ?? i.sourceTransaction?.id('hex')) === record.ticket.pkg.current.txid && i.sourceOutputIndex === record.ticket.pkg.current.index)) throw Error('Funding must not spend the ticket.')
   if (!await validated.verify('scripts only')) throw Error('Funding transaction scripts failed verification.')
   await checkHolder(wallet, record.ticket, signal)
   await keyMatches(wallet, funding.key, signal)
   return checked
  }
  const checked = await read(work, signal)
  return await finish(store, record.id, attempt.id, 'fundAttempt', 'complete', { funding: checked })
 } catch {
  return finish(store, record.id, attempt.id, 'fundAttempt', 'unknown')
 }
}

export function fundingCandidate(value: Funding, valueObservation: ArcObservation): Funding {
 const tx = fundingTx(value), observation = parseObservation(valueObservation, value.txid!)
 verifyMiningAnchor(observation, undefined) // Validates mined status, txid membership, height and complete block context.
 const proof = MerklePath.fromHex(observation.merklePath!)
 const before = tx.toHex()
 tx.merklePath = proof
 const candidate = { ...value, observation, beef: Utils.toBase64(tx.toAtomicBEEF()) }
 if (fundingTx(candidate).toHex() !== before) throw Error('Funding proof changed the signed transaction.')
 return candidate
}
export async function prepareSigning(record: SenderRecord, wallet: Reader, snapshot: HeaderSnapshot | undefined, signal: AbortSignal): Promise<void> {
 record = readSender(record)
 const ticket = readHandoffTicket(record.ticket), funding = record.funding
 if (record.id !== sourceKey(ticket) || record.fundAttempt?.outcome !== 'complete' || !funding) throw Error('Complete dedicated funding is required before signing.')
 const expected = budget(funding.policy)
 if (expected.amount !== funding.amount || funding.key.keyID !== sourceKey(ticket) || !same(funding.key.protocolID, FUNDING_PROTOCOL) || funding.key.counterparty !== 'self') throw Error('Funding budget or source key changed.')
 await minedTicket(ticket, snapshot)
 await checkHolder(wallet, ticket, signal)
 await keyMatches(wallet, funding.key, signal)
 const tx = fundingTx(funding)
 if (!tx.merklePath || !funding.observation) throw Error('Locally verified funding mining evidence is required.')
 if (funding.observation.txid !== tx.id('hex') || !verifyMiningAnchor(funding.observation, snapshot)) throw Error('Funding mining block is not verified against local headers.')
 const observedProof = MerklePath.fromHex(funding.observation.merklePath!)
 if (tx.merklePath.blockHeight !== observedProof.blockHeight || tx.merklePath.computeRoot(funding.txid!) !== observedProof.computeRoot(funding.txid!)) throw Error('Funding proof differs from the observed mining proof.')
 const report = await verifySigningEvidence(readSigningEvidenceBytes(funding.txid!, fromBase64(funding.beef!)), snapshot)
 if (!report.subjectMined) throw Error('Mined funding is required.')
 if (funding.txid === ticket.pkg.current.txid) throw Error('Fee funding must be a separate transaction.')
 await checkHolder(wallet, ticket, signal)
 await keyMatches(wallet, funding.key, signal)
 signal.throwIfAborted()
}
export async function signHandoff(record: SenderRecord, value: HandoffRequest, wallet: Signer, snapshot: HeaderSnapshot | undefined, signal: AbortSignal, store: RecordStore<SenderRecord>): Promise<SenderRecord> {
 record = readSender(record)
 await freshRecord(record, store)
 if (record.signAttempt || record.transfer) throw Error('Signing was already attempted; signed bytes cannot be revoked or retried.')
 const request = readHandoffRequest(value)
 if (!same(request.invitation, invitationFor(record.ticket, request.invitation.requiredHeight))) throw Error('Receiving request does not match this source, event or trusted venue.')
 if (request.request.recipient.publicKey === record.ticket.pkg.request.recipient.publicKey) throw Error('Use a different receiving key for the new holder.')
 await prepareSigning(record, wallet, snapshot, signal)
 const funding = record.funding!, pkg = record.ticket.pkg
 const requiredHeight = Math.max(readSigningEvidenceBytes(pkg.current.txid, fromBase64(pkg.atomicBeefBase64)).requiredHeight, readSigningEvidenceBytes(funding.txid!, fromBase64(funding.beef!)).requiredHeight)
 if (request.invitation.requiredHeight !== undefined && request.invitation.requiredHeight < requiredHeight) throw Error('The invitation header height is below the actual input requirements. Prepare a new receiving request with current funding headers.')
 const ticketInput = Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64)), feeInput = fundingTx(funding)
 const tx = new Transaction(1, [
  { sourceTransaction: ticketInput, sourceOutputIndex: pkg.current.index, sequence: 0xffffffff },
  { sourceTransaction: feeInput, sourceOutputIndex: funding.index!, sequence: 0xffffffff },
 ], [{ satoshis: 1, lockingScript: ticketScript(pkg.issuance.eventId, pkg.issuance.ticketId, pkg.issuance.origin, request.request) }], 0)
 // Reserve before either signature. The claim belongs to the source, not this request.
 const attempt = { id: crypto.randomUUID(), outcome: 'pending' as const, startedAt: new Date().toISOString() }
 signal.throwIfAborted()
 await write(store, record, { request, signAttempt: attempt })
 try {
  await prepareSigning(record, wallet, snapshot, signal)
  const keys = [pkg.request.recipient, funding.key]
  for (let index = 0; index < keys.length; index++) {
   await checkHolder(wallet, record.ticket, signal)
   await keyMatches(wallet, funding.key, signal)
   const key = keys[index]
   tx.inputs[index].unlockingScript = await read(() => new PushDrop(wallet as WalletInterface).unlock(key.protocolID, key.keyID, key.counterparty, 'all', false).sign(tx, index), signal)
  }
  await checkHolder(wallet, record.ticket, signal)
  await keyMatches(wallet, funding.key, signal)
  const size = tx.toBinary().length
  if (size > 4096) throw Error('Signed transfer exceeds the reviewed 4096-byte budget.')
  checkPolicy({ rawBytes: size, fee: funding.amount }, funding.policy)
  if (!await tx.verify('scripts only')) throw Error('Signed handoff transaction scripts failed verification.')
  const nextPackage = readTicketPackage(JSON.stringify({ ...pkg, current: { txid: tx.id('hex'), index: 0 }, request: request.request, lineageRawTxs: [...pkg.lineageRawTxs, tx.toHex()], atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) }))
  const transfer = readHandoffTicket({ ...record.ticket, holder: request.recipientIdentity, pkg: nextPackage, request, savedAt: new Date().toISOString() })
  const verified = await verifyHandoffTicket(transfer, snapshot)
  if (verified.verdict !== 'verified') throw Error('Signed handoff package failed local verification: ' + verified.checks.filter(c => c.status !== 'pass').map(c => c.reason).join('; '))
  signal.throwIfAborted()
  return await finish(store, record.id, attempt.id, 'signAttempt', 'complete', { transfer })
 } catch {
  return finish(store, record.id, attempt.id, 'signAttempt', 'unknown')
 }
}
