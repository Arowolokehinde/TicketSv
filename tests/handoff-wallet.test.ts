import { expect, it, vi } from 'vitest'
import { LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { createReceivingRequest, checkHolder, reviewFunding, fundHandoff, fundingCandidate, prepareSigning, signHandoff } from '../src/handoff/wallet.ts'
import { fromAttendee, invitationFor, readHandoffRequest } from '../src/handoff/evidence.ts'
import { readSender } from '../src/handoff/store.ts'
import type { SenderRecord, RecordStore } from '../src/handoff/types.ts'
import * as miningEvidence from '../src/settlement/evidence.ts'
import type { HeaderSnapshot } from '../src/headers/validate.ts'

function walletFor(key: number): WalletInterface {
 const wallet = new ProtoWallet(new PrivateKey(key)) as WalletInterface
 wallet.getNetwork = async () => ({ network: 'testnet' })
 return wallet
}
const signal = () => new AbortController().signal
async function fixture() {
 const f = await attendeeOfflineFixture()
 return { ...f, ticket: fromAttendee(attendeeEvidence(f.record, f.identity, 'http://127.0.0.1:4175')), wallet: walletFor(2) }
}
it('creates two real signatures bound to the independent invitation and recipient identity', async () => {
 const { ticket } = await fixture(), wallet = walletFor(3)
 const request = await createReceivingRequest(wallet, invitationFor(ticket), signal())
 expect(readHandoffRequest(request)).toEqual(request)
 expect(request.recipientIdentity).toBe((await wallet.getPublicKey({ identityKey: true })).publicKey)
 expect(() => readHandoffRequest({ ...request, recipientIdentity: ticket.holder })).toThrow()
 expect(() => readHandoffRequest({ ...request, invitation: { ...request.invitation, source: { ...request.invitation.source, index: 1 } } })).toThrow()
})
it('rejects wrong holder, network and a receiving key switched during request signing', async () => {
 const { ticket } = await fixture()
 await expect(checkHolder(walletFor(3), ticket, signal())).rejects.toThrow(/identity|holder/i)
 const wallet = walletFor(2)
 wallet.getNetwork = async () => ({ network: 'mainnet' })
 await expect(checkHolder(wallet, ticket, signal())).rejects.toThrow(/testnet/i)
 const recipient = walletFor(3), original = recipient.createSignature.bind(recipient)
 recipient.createSignature = async args => { const result = await original(args); recipient.getPublicKey = walletFor(4).getPublicKey.bind(walletFor(4)); return result }
 await expect(createReceivingRequest(recipient, invitationFor(ticket), signal())).rejects.toThrow(/identity|key/i)
})

// Only the synthetic header boundary is replaced; signatures, BEEF and script verification remain real.
vi.mock('../src/headers/tracker.ts', async original => ({ ...await original<object>(), createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }) }))
const snapshot = { version: 1, network: 'testnet', syncedAt: new Date().toISOString(), id: 'synthetic-local-headers', headers: [{ height: 1762500, hash: '22'.repeat(32), hex: '00'.repeat(80) }] } as HeaderSnapshot
const policy = { maxTxBytes: 100000, feeSatoshis: 1, feeBytes: 1000 }
function memory(record: SenderRecord): RecordStore<SenderRecord> {
 let saved = readSender(record)
 return { load: async id => id === saved.id ? structuredClone(saved) : undefined, list: async () => [structuredClone(saved)], save: async (next, expected) => { if (saved.revision !== expected) throw Error('Revision conflict'); saved = readSender(next, saved) } }
}
async function prepared() {
 const f = await fixture(), { ticket, wallet } = f
 const key = ticket.pkg.request.recipient
 wallet.listOutputs = async () => ({ totalOutputs: 1, outputs: [{ outpoint: `${ticket.pkg.current.txid}.0`, satoshis: 1, lockingScript: f.tx.outputs[0].lockingScript.toHex(), spendable: true, customInstructions: JSON.stringify({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, type: 'PushDrop' }), tags: [], labels: [] }] })
 const record: SenderRecord = { kind: 'ticketsv-handoff-sender', version: 1, id: `${ticket.holder}:testnet:${ticket.pkg.current.txid}.0`, revision: 0, ticket }
 return { ...f, record, store: memory(record) }
}
it('reviews the 4096-byte policy budget without spending and requires the matching wallet record', async () => {
 const f = await prepared()
 const review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot)
 expect(review.amount).toBe(5)
 await expect(reviewFunding(f.ticket, { ...policy, feeSatoshis: 1000 }, f.wallet, signal(), snapshot)).rejects.toThrow(/1000|budget/)
 await expect(reviewFunding(f.ticket, { ...policy, maxTxBytes: 4095 }, f.wallet, signal(), snapshot)).rejects.toThrow(/4096|size/)
 f.wallet.listOutputs = async () => ({ totalOutputs: 0, outputs: [] })
 await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot)).rejects.toThrow(/wallet|record/i)
})
it('claims funding before dispatch and preserves malformed wallet receipts without retry', async () => {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot)
 let calls = 0
 f.wallet.createAction = async args => {
  calls++
  expect((await f.store.load(f.record.id))?.fundAttempt?.outcome).toBe('pending')
  expect(args.inputs).toBeUndefined()
  expect(args.outputs?.[0].basket).toBe('ticketsv-handoff-fees')
  expect(args.outputs?.[0].satoshis).toBe(5)
  return { txid: 'aa'.repeat(32), tx: [1, 2, 3] }
 }
 const result = await fundHandoff(f.record, review, f.wallet, signal(), f.store)
 expect(result.fundAttempt?.outcome).toBe('unknown')
 expect(result.funding?.rawReceipt).toEqual({ txid: 'aa'.repeat(32), tx: [1, 2, 3] })
 await expect(fundHandoff(f.record, review, f.wallet, signal(), f.store)).rejects.toThrow(/attempt|revision|changed/i)
 expect(calls).toBe(1)
})
async function fundFixture() {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot)
 f.wallet.createAction = async args => {
  const parent = new Transaction(1, [], [{ satoshis: 100, lockingScript: LockingScript.fromASM('OP_TRUE') }])
  parent.merklePath = new MerklePath(1762324, [[{ offset: 1, hash: parent.id('hex'), txid: true }, { offset: 0, hash: '11'.repeat(32) }]])
  const tx = new Transaction(1, [{ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() }], args.outputs!.map(o => ({ satoshis: o.satoshis, lockingScript: LockingScript.fromHex(o.lockingScript) })))
  return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
 }
 const funded = await fundHandoff(f.record, review, f.wallet, signal(), f.store)
 return { ...f, funded, review }
}
it('accepts exact dedicated funding, validates proof context and refuses signing before mining', async () => {
 const f = await fundFixture()
 expect(f.funded.fundAttempt?.outcome).toBe('complete')
 await expect(prepareSigning(f.funded, f.wallet, snapshot, signal())).rejects.toThrow(/mining|mined/)
 const funding = f.funded.funding!, proof = new MerklePath(1762324, [[{ offset: 1, hash: funding.txid!, txid: true }, { offset: 0, hash: '11'.repeat(32) }]])
 const observation = { txid: funding.txid!, txStatus: 'MINED', observedAt: new Date().toISOString(), blockHeight: 1762324, blockHash: '22'.repeat(32), merklePath: proof.toHex() }
 const candidate = fundingCandidate(funding, observation)
 expect(Transaction.fromAtomicBEEF(Utils.toArray(candidate.beef!, 'base64')).toHex()).toBe(Transaction.fromAtomicBEEF(Utils.toArray(funding.beef!, 'base64')).toHex())
 expect(() => fundingCandidate(funding, { ...observation, txid: 'aa'.repeat(32) })).toThrow()
 expect(() => fundingCandidate(funding, { ...observation, blockHeight: 1762325 })).toThrow()
 expect(() => fundingCandidate(funding, { ...observation, blockHash: undefined })).toThrow()
})
it('keeps cancellation unknown and durably appends a late funding receipt', async () => {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot), controller = new AbortController()
 let resolve!: (result: { txid: string; tx: number[] }) => void
 f.wallet.createAction = () => new Promise(r => { resolve = r })
 const pending = fundHandoff(f.record, review, f.wallet, controller.signal, f.store)
 await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
 controller.abort()
 expect((await pending).fundAttempt?.outcome).toBe('unknown')
 resolve({ txid: 'aa'.repeat(32), tx: [1, 2] })
 await vi.waitFor(async () => expect((await f.store.load(f.record.id))?.funding?.rawReceipt).toEqual({ txid: 'aa'.repeat(32), tx: [1, 2] }))
 expect((await f.store.load(f.record.id))?.fundAttempt?.outcome).toBe('unknown')
})
async function signingFixture() {
 const f = await fundFixture(), funding = f.funded.funding!
 const proof = new MerklePath(1762325, [[{ offset: 1, hash: funding.txid!, txid: true }, { offset: 0, hash: '11'.repeat(32) }]])
 const observation = { txid: funding.txid!, txStatus: 'MINED', observedAt: new Date().toISOString(), blockHeight: 1762325, blockHash: '22'.repeat(32), merklePath: proof.toHex() }
 const record = { ...f.funded, revision: f.funded.revision + 1, funding: fundingCandidate(funding, observation) }
 await f.store.save(record, f.funded.revision)
 // Synthetic proofs are checked by a synthetic header boundary; request/tx crypto stays real.
 const anchor = vi.spyOn(miningEvidence, 'verifyMiningAnchor').mockReturnValue(true)
 const request = await createReceivingRequest(walletFor(3), invitationFor(f.ticket), signal())
 return { ...f, record, request, anchor }
}
it('signs exactly the ticket and fee input offline with real signatures and one recipient output', async () => {
 const f = await signingFixture()
 try {
  f.wallet.createAction = async () => { throw Error('Offline signing must not create a wallet action') }
  f.wallet.listOutputs = async () => { throw Error('Offline signing must not query wallet outputs') }
  const sign = f.wallet.createSignature.bind(f.wallet)
  let count = 0
  f.wallet.createSignature = async args => {
   count++
   expect((await f.store.load(f.record.id))?.signAttempt?.outcome).toBe('pending')
   return sign(args)
  }
  const result = await signHandoff(f.record, f.request, f.wallet, snapshot, signal(), f.store)
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(count).toBe(2)
  const transfer = result.transfer!, tx = Transaction.fromAtomicBEEF(Utils.toArray(transfer.pkg.atomicBeefBase64, 'base64'))
  expect(tx.inputs).toHaveLength(2)
  expect(tx.outputs).toHaveLength(1)
  expect(tx.outputs[0].satoshis).toBe(1)
  expect(tx.inputs.map(i => i.sourceTXID)).toEqual([f.ticket.pkg.current.txid, f.record.funding!.txid])
  expect(await tx.verify('scripts only')).toBe(true)
  expect(transfer.holder).toBe(f.request.recipientIdentity)
  await expect(signHandoff(result, f.request, f.wallet, snapshot, signal(), f.store)).rejects.toThrow(/already attempted/)
 } finally { f.anchor.mockRestore() }
})
it('blocks source substitution before signature and leaves lost signatures permanently unknown', async () => {
 const f = await signingFixture()
 try {
  const other = await fixture(), bad = await createReceivingRequest(walletFor(3), invitationFor(other.ticket), signal())
  await expect(signHandoff(f.record, bad, f.wallet, snapshot, signal(), f.store)).rejects.toThrow(/request|source/)
  f.wallet.createSignature = async () => { throw Error('Wallet response lost') }
  const result = await signHandoff(f.record, f.request, f.wallet, snapshot, signal(), f.store)
  expect(result.signAttempt?.outcome).toBe('unknown')
  expect(result.transfer).toBeUndefined()
  await expect(signHandoff(result, f.request, f.wallet, snapshot, signal(), f.store)).rejects.toThrow(/already attempted/)
 } finally { f.anchor.mockRestore() }
})
it('allows only one simultaneous funding claim and refuses a holder switch during the durable claim', async () => {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot)
 let calls = 0
 f.wallet.createAction = async () => { calls++; throw Error('lost response') }
 const outcomes = await Promise.allSettled([fundHandoff(f.record, review, f.wallet, signal(), f.store), fundHandoff(f.record, review, f.wallet, signal(), f.store)])
 expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
 expect(calls).toBe(1)
 const other = await prepared(), otherReview = await reviewFunding(other.ticket, policy, other.wallet, signal(), snapshot)
 const save = other.store.save
 other.store.save = async (next, expected) => { await save(next, expected); if (next.fundAttempt?.outcome === 'pending') other.wallet.getNetwork = async () => ({ network: 'mainnet' }) }
 other.wallet.createAction = async () => { calls++; throw Error('must not dispatch') }
 expect((await fundHandoff(other.record, otherReview, other.wallet, signal(), other.store)).fundAttempt?.outcome).toBe('unknown')
 expect(calls).toBe(1)
})
it('keeps cancellation during a signature unknown even after the wallet returns signed bytes', async () => {
 const f = await signingFixture(), controller = new AbortController()
 try {
  const sign = f.wallet.createSignature.bind(f.wallet)
  let resolve!: () => void
  f.wallet.createSignature = async args => { await new Promise<void>(r => { resolve = r }); return sign(args) }
  const signing = signHandoff(f.record, f.request, f.wallet, snapshot, controller.signal, f.store)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  controller.abort()
  expect((await signing).signAttempt?.outcome).toBe('unknown')
  resolve()
  await Promise.resolve()
  expect((await f.store.load(f.record.id))?.transfer).toBeUndefined()
 } finally { f.anchor.mockRestore() }
})
it('honors the signed header preparation hint while refusing a height below the actual input requirements', async () => {
 const f = await signingFixture()
 try {
  const recipient = walletFor(3)
  const tooLow = await createReceivingRequest(recipient, invitationFor(f.ticket, 1762000), signal())
  await expect(signHandoff(f.record, tooLow, f.wallet, snapshot, signal(), f.store)).rejects.toThrow(/height|header/i)
  const request = await createReceivingRequest(recipient, invitationFor(f.ticket, 1762500), signal())
  const result = await signHandoff(f.record, request, f.wallet, snapshot, signal(), f.store)
  expect(result.signAttempt?.outcome).toBe('complete')
 } finally { f.anchor.mockRestore() }
})
it('rejects funding output amount, source-key and local mining-block substitutions before signing', async () => {
 const f = await signingFixture()
 try {
  const funding = f.record.funding!
  await expect(prepareSigning({ ...f.record, funding: { ...funding, amount: 6 } }, f.wallet, snapshot, signal())).rejects.toThrow(/amount|receipt|budget/)
  await expect(prepareSigning({ ...f.record, funding: { ...funding, key: { ...funding.key, keyID: 'different-source' } } }, f.wallet, snapshot, signal())).rejects.toThrow(/key|source/)
  f.anchor.mockReturnValue(false)
  await expect(prepareSigning(f.record, f.wallet, snapshot, signal())).rejects.toThrow(/block|headers/)
 } finally { f.anchor.mockRestore() }
})
it('preserves the returned funding receipt when cancellation wins a simultaneous revision race', async () => {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot), controller = new AbortController()
 const receipt = { txid: 'aa'.repeat(32), tx: [1, 2, 3] }
 let walletCalls = 0, releaseReceipt!: () => void, receiptWriteStarted!: () => void
 const writingReceipt = new Promise<void>(resolve => { receiptWriteStarted = resolve })
 const originalSave = f.store.save
 let gated = false
 f.store.save = async (next, expected) => {
  if (next.funding?.rawReceipt && !gated) {
   gated = true
   receiptWriteStarted()
   await new Promise<void>(resolve => { releaseReceipt = resolve })
  }
  return originalSave(next, expected)
 }
 f.wallet.createAction = async () => { walletCalls++; return receipt }
 const pending = fundHandoff(f.record, review, f.wallet, controller.signal, f.store)
 await writingReceipt
 controller.abort()
 const cancelled = await pending
 expect(cancelled.fundAttempt?.outcome).toBe('unknown')
 const finishedAt = cancelled.fundAttempt?.finishedAt
 releaseReceipt()
 await vi.waitFor(async () => expect((await f.store.load(f.record.id))?.funding?.rawReceipt).toEqual(receipt))
 const saved = (await f.store.load(f.record.id))!
 expect(saved.fundAttempt?.outcome).toBe('unknown')
 expect(saved.fundAttempt?.finishedAt).toBe(finishedAt)
 expect(walletCalls).toBe(1)
})
it('finishes cancellation as unknown when the receipt wins the simultaneous revision race', async () => {
 const f = await prepared(), review = await reviewFunding(f.ticket, policy, f.wallet, signal(), snapshot), controller = new AbortController()
 const receipt = { txid: 'bb'.repeat(32), tx: [4, 5, 6] }
 let walletCalls = 0, resolveWallet!: (value: typeof receipt) => void, releaseFinish!: () => void, finishStarted!: () => void
 const finishing = new Promise<void>(resolve => { finishStarted = resolve })
 const originalSave = f.store.save
 let gated = false
 f.store.save = async (next, expected) => {
  if (next.fundAttempt?.outcome === 'unknown' && !gated) {
   gated = true
   finishStarted()
   await new Promise<void>(resolve => { releaseFinish = resolve })
  }
  return originalSave(next, expected)
 }
 f.wallet.createAction = () => { walletCalls++; return new Promise(resolve => { resolveWallet = resolve }) }
 const pending = fundHandoff(f.record, review, f.wallet, controller.signal, f.store)
 await vi.waitFor(() => expect(resolveWallet).toBeTypeOf('function'))
 controller.abort()
 await finishing
 resolveWallet(receipt)
 await vi.waitFor(async () => expect((await f.store.load(f.record.id))?.funding?.rawReceipt).toEqual(receipt))
 releaseFinish()
 const result = await pending
 expect(result.fundAttempt?.outcome).toBe('unknown')
 expect(result.funding?.rawReceipt).toEqual(receipt)
 expect((await f.store.load(f.record.id))?.fundAttempt?.outcome).toBe('unknown')
 expect(walletCalls).toBe(1)
})
