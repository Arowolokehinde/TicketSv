import { Beef, LockingScript, MerklePath, OP, PushDrop, Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import { fromBase64, publicKey, readTicketPackage } from '../tickets/codec.ts'
import { RECEIVE_PROTOCOL, type KeyBinding } from '../tickets/types.ts'
import { ticketScript } from '../tickets/script.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { checkPolicy, parseObservation, parsePolicy } from '../settlement/arc.ts'
import { verifyMiningAnchor } from '../settlement/evidence.ts'
import type { ArcObservation, ArcPolicy } from '../settlement/types.ts'
import { readSigningEvidenceBytes, verifySigningEvidence } from '../verification/signing-spv.ts'
import { waitImport } from '../wallet/mined-import.ts'
import { inspectTicketWalletRecord } from '../wallet/ticket-record.ts'
import {
  HANDOFF_PROTOCOL,
  type Funding,
  type HandoffRequest,
  type HandoffTicket,
  type Invitation,
  type RecordStore,
  type SenderRecord,
} from './types.ts'
import { invitationFor, readHandoffRequest, readHandoffTicket, readInvitation, requestBytes, verifyHandoffTicket } from './evidence.ts'

import { readSender, sourceKey } from './store.ts'
import { checkWallet } from '../wallet/identity.ts'

type Reader = Pick<WalletInterface, 'getNetwork' | 'getPublicKey'>
type Signer = Reader &
  Pick<WalletInterface, 'createSignature'> &
  Partial<Pick<WalletInterface, 'createAction' | 'signAction' | 'abortAction'>>
type Funder = Reader & Pick<WalletInterface, 'listOutputs' | 'createAction'>
export type FundingReview = Funding & { ticket: HandoffTicket; snapshot: HeaderSnapshot }
export const FUNDING_BASKET = 'ticketsv-handoff-fees'
export const FUNDING_PROTOCOL: [2, string] = [2, 'ticketsv handoff fees']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
async function read<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const value = await waitImport(work, signal)
  signal.throwIfAborted()
  return value
}
async function identity(wallet: Reader, expected: string | undefined, signal: AbortSignal): Promise<string> {
  return publicKey(
    await checkWallet(
      wallet,
      {
        identity: expected || undefined,
        messages: { network: 'Select testnet in your wallet.', identity: 'Wallet identity does not match the ticket holder.' },
      },
      (_method, work) => read(work, signal),
    ),
  )
}
export async function keyMatches(wallet: Reader, key: KeyBinding, signal: AbortSignal): Promise<void> {
  if (
    (
      await read(
        () => wallet.getPublicKey({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, forSelf: true }),
        signal,
      )
    ).publicKey !== key.publicKey
  )
    throw Error('Wallet receiving key changed or does not match.')
}
export async function checkHolder(wallet: Reader, value: HandoffTicket, signal: AbortSignal): Promise<void> {
  const ticket = readHandoffTicket(value)
  await identity(wallet, ticket.holder, signal)
  await keyMatches(wallet, ticket.pkg.request.recipient, signal)
  await identity(wallet, ticket.holder, signal)
}
export async function createReceivingRequest(wallet: Signer, value: Invitation, signal: AbortSignal): Promise<HandoffRequest> {
  const invitation = readInvitation(value),
    recipientIdentity = await identity(wallet, undefined, signal),
    requestId = crypto.randomUUID()
  const binding = { protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self' }
  const key = publicKey((await read(() => wallet.getPublicKey({ ...binding, forSelf: true }), signal)).publicKey)
  const request: HandoffRequest['request'] = {
    kind: 'ticket-request',
    version: 1,
    network: 'testnet',
    requestId,
    recipient: { ...binding, publicKey: key },
  }
  const context = { invitation, recipientIdentity, request },
    data = requestBytes(context)
  const fresh = async () => {
    await identity(wallet, recipientIdentity, signal)
    await keyMatches(wallet, request.recipient, signal)
    await identity(wallet, recipientIdentity, signal)
  }
  await fresh()
  const keySignature = Utils.toBase64((await read(() => wallet.createSignature({ ...binding, data }), signal)).signature)
  await fresh()
  const identitySignature = Utils.toBase64(
    (await read(() => wallet.createSignature({ protocolID: HANDOFF_PROTOCOL, keyID: requestId, counterparty: 'anyone', data }), signal))
      .signature,
  )
  await fresh()
  return readHandoffRequest({ kind: 'ticketsv-handoff-request', version: 1, ...context, keySignature, identitySignature })
}

function budget(value: ArcPolicy): { amount: number; policy: ArcPolicy } {
  const policy = parsePolicy({
    policy: { maxtxsizepolicy: value.maxTxBytes, miningFee: { satoshis: value.feeSatoshis, bytes: value.feeBytes } },
  })
  if (policy.maxTxBytes < 4096) throw Error('Provider size policy cannot support the 4096-byte budget.')
  const cost = (4096n * BigInt(policy.feeSatoshis) + BigInt(policy.feeBytes) - 1n) / BigInt(policy.feeBytes)
  if (cost > 1000n) throw Error('The fee budget exceeds the 1000-satoshi cap.')
  return { amount: Math.max(1, Number(cost)), policy }
}
// BSV Desktop builds wallet-managed transactions at 250 sat/kB. Sizing the
// dedicated fee output to cover that fee, with a surplus below the wallet's
// dust floor, keeps the wallet from adding change or extra inputs. These
// replicate wallet-toolbox's transactionSize, fee and dust formulas.
export const WALLET_FEE_RATE = 250
const UNLOCK_LENGTH = 74 // push byte + DER signature with sighash byte
const varint = (n: number) => (n <= 0xfc ? 1 : n <= 0xffff ? 3 : n <= 0xffffffff ? 5 : 9)
export function walletTransactionSize(inputs: number[], outputs: number[]): number {
  return (
    4 +
    varint(inputs.length) +
    inputs.reduce((n, s) => n + 40 + varint(s) + s, 0) +
    varint(outputs.length) +
    outputs.reduce((n, s) => n + varint(s) + s + 8, 0) +
    4
  )
}
const walletFee = (size: number) => Math.ceil((size / 1000) * WALLET_FEE_RATE)
export function walletWindowAmount(value: HandoffTicket): number {
  const ticket = readHandoffTicket(value),
    i = ticket.pkg.issuance,
    placeholder = '00000000-0000-4000-8000-000000000000'
  const script = ticketScript(i.eventId, i.ticketId, i.origin, {
    ...ticket.pkg.request,
    requestId: placeholder,
    recipient: { ...ticket.pkg.request.recipient, keyID: placeholder },
  })
  const dust = Math.max(1, walletFee(walletTransactionSize([107], [25])) * 2)
  return walletFee(walletTransactionSize([UNLOCK_LENGTH, UNLOCK_LENGTH], [script.toBinary().length])) + Math.floor(dust / 2)
}
function feeScript(key: KeyBinding): LockingScript {
  return new LockingScript()
    .writeBin(Utils.toArray(publicKey(key.publicKey), 'hex'))
    .writeOpCode(OP.OP_CHECKSIG)
    .writeBin(Utils.toArray(JSON.stringify(['ticketsv-handoff-fee', 1, 'testnet', key.keyID]), 'utf8'))
    .writeOpCode(OP.OP_DROP) as LockingScript
}
async function minedTicket(ticket: HandoffTicket, snapshot: HeaderSnapshot | undefined): Promise<void> {
  const report = await verifyHandoffTicket(ticket, snapshot)
  if (report.verdict !== 'verified' || !report.presentedTransferMined)
    throw Error(
      'A locally verified mined ticket is required: ' +
        report.checks
          .filter(c => c.status !== 'pass')
          .map(c => c.reason)
          .join('; '),
    )
}
// Uses the same basic-metadata observation as receiving: native wallets such as
// BSV Browser omit locking scripts, and capped listings are paged.
async function walletRecord(wallet: Funder, ticket: HandoffTicket, signal: AbortSignal): Promise<void> {
  await checkHolder(wallet, ticket, signal)
  const output = Transaction.fromAtomicBEEF(fromBase64(ticket.pkg.atomicBeefBase64)).outputs[ticket.pkg.current.index]
  const record = await inspectTicketWalletRecord(args => read(() => wallet.listOutputs(args), signal), {
    outpoint: `${ticket.pkg.current.txid}.${ticket.pkg.current.index}`,
    satoshis: output.satoshis!,
    lockingScript: output.lockingScript.toHex(),
    key: ticket.pkg.request.recipient,
  })
  await checkHolder(wallet, ticket, signal)
  if (record.state === 'absent') throw Error('A matching spendable ticket record is required in the wallet.')
  if (record.state !== 'present') throw Error('Wallet ticket records are incomplete or differ from this ticket. Recheck the wallet record.')
}
export async function reviewFunding(
  value: HandoffTicket,
  policy: ArcPolicy,
  wallet: Funder,
  signal: AbortSignal,
  snapshot: HeaderSnapshot | undefined,
): Promise<FundingReview> {
  const ticket = readHandoffTicket(value),
    legacy = budget(policy),
    cost = { ...legacy, amount: Math.max(legacy.amount, walletWindowAmount(ticket)) }
  if (cost.amount > 1000) throw Error('The fee budget exceeds the 1000-satoshi cap.')
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
const failureReason = (error: unknown) => (error instanceof Error && error.message ? error.message : 'No reason was reported.')
async function finish(
  store: RecordStore<SenderRecord>,
  id: string,
  attemptId: string,
  field: 'fundAttempt' | 'signAttempt',
  outcome: 'complete' | 'unknown',
  patch: Partial<SenderRecord> = {},
  reason?: string,
): Promise<SenderRecord> {
  let current = await store.load(id)
  for (let tries = 0; tries < 3; tries++) {
    if (!current || current[field]?.id !== attemptId) throw Error('The durable source claim changed.')
    // Another local completion is authoritative; terminal outcomes never reverse.
    if (current[field]!.outcome !== 'pending') return current
    const merged = { ...patch, ...(patch.funding ? { funding: { ...current.funding, ...patch.funding } } : {}) }
    try {
      const ended = {
        ...current[field],
        outcome,
        finishedAt: new Date().toISOString(),
        ...(reason ? { reason: reason.slice(0, 300) } : {}),
      }
      return await write(store, current, { ...merged, [field]: ended })
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
  if (!funding.txid || !funding.beef || !Number.isSafeInteger(funding.index) || funding.index! < 0)
    throw Error('Complete funding receipt required.')
  const evidence = readSigningEvidenceBytes(funding.txid, fromBase64(funding.beef))
  const tx = Transaction.fromAtomicBEEF([...evidence.atomicBeef]),
    output = tx.outputs[funding.index!]
  if (!output || output.satoshis !== funding.amount || output.lockingScript.toHex() !== feeScript(funding.key).toHex())
    throw Error('Funding output amount or script does not match.')
  if (tx.outputs.filter(o => o.lockingScript.toHex() === feeScript(funding.key).toHex()).length !== 1)
    throw Error('Duplicated funding output.')
  return tx
}
export async function fundHandoff(
  record: SenderRecord,
  review: FundingReview,
  wallet: Funder,
  signal: AbortSignal,
  store: RecordStore<SenderRecord>,
): Promise<SenderRecord> {
  record = readSender(record)
  review = structuredClone(review)
  await freshRecord(record, store)
  if (record.fundAttempt || record.signAttempt || record.funding)
    throw Error('Funding was already attempted; no automatic retry is available.')
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
      const receipt = await wallet.createAction({
        description: 'Prepare TicketSV handoff fee output',
        outputs: [
          {
            satoshis: funding.amount,
            lockingScript: feeScript(funding.key).toHex(),
            outputDescription: 'Dedicated fee for one offline ticket handoff',
            basket: FUNDING_BASKET,
            customInstructions: JSON.stringify({
              protocolID: funding.key.protocolID,
              keyID: funding.key.keyID,
              counterparty: funding.key.counterparty,
              type: 'PushDrop',
            }),
          },
        ],
        options: { noSend: false, acceptDelayedBroadcast: false, returnTXIDOnly: false, randomizeOutputs: false },
      })
      await appendFundingReceipt(store, record.id, attempt.id, receipt)
      signal.throwIfAborted()
      if (receipt.signableTransaction || !receipt.txid || !receipt.tx) throw Error('Wallet did not return a final funded transaction.')
      const tx = Transaction.fromAtomicBEEF(receipt.tx)
      const indices = tx.outputs.flatMap((o, i) => (o.lockingScript.toHex() === feeScript(funding.key).toHex() ? [i] : []))
      if (indices.length !== 1) throw Error('Dedicated funding output missing or duplicated.')
      const checked = { ...funding, rawReceipt: receipt, txid: receipt.txid, beef: Utils.toBase64(receipt.tx), index: indices[0] }
      const validated = fundingTx(checked)
      if (
        validated.inputs.some(
          i =>
            (i.sourceTXID ?? i.sourceTransaction?.id('hex')) === record.ticket.pkg.current.txid &&
            i.sourceOutputIndex === record.ticket.pkg.current.index,
        )
      )
        throw Error('Funding must not spend the ticket.')
      if (!(await validated.verify('scripts only'))) throw Error('Funding transaction scripts failed verification.')
      await checkHolder(wallet, record.ticket, signal)
      await keyMatches(wallet, funding.key, signal)
      return checked
    }
    const checked = await read(work, signal)
    return await finish(store, record.id, attempt.id, 'fundAttempt', 'complete', { funding: checked })
  } catch (error) {
    return finish(store, record.id, attempt.id, 'fundAttempt', 'unknown', {}, failureReason(error))
  }
}

export function fundingCandidate(value: Funding, valueObservation: ArcObservation): Funding {
  const tx = fundingTx(value),
    observation = parseObservation(valueObservation, value.txid!)
  verifyMiningAnchor(observation, undefined) // Validates mined status, txid membership, height and complete block context.
  const proof = MerklePath.fromHex(observation.merklePath!)
  const before = tx.toHex()
  tx.merklePath = proof
  const candidate = { ...value, observation, beef: Utils.toBase64(tx.toAtomicBEEF()) }
  if (fundingTx(candidate).toHex() !== before) throw Error('Funding proof changed the signed transaction.')
  return candidate
}
export async function prepareSigning(
  record: SenderRecord,
  wallet: Reader,
  snapshot: HeaderSnapshot | undefined,
  signal: AbortSignal,
): Promise<void> {
  record = readSender(record)
  const ticket = readHandoffTicket(record.ticket),
    funding = record.funding
  if (record.id !== sourceKey(ticket) || record.fundAttempt?.outcome !== 'complete' || !funding)
    throw Error('Complete dedicated funding is required before signing.')
  // Records funded before wallet-window sizing keep their legacy ARC budget.
  const legacy = budget(funding.policy).amount
  if (
    (funding.amount !== legacy && funding.amount !== Math.max(legacy, walletWindowAmount(ticket))) ||
    funding.key.keyID !== sourceKey(ticket) ||
    !same(funding.key.protocolID, FUNDING_PROTOCOL) ||
    funding.key.counterparty !== 'self'
  )
    throw Error('Funding budget or source key changed.')
  await minedTicket(ticket, snapshot)
  await checkHolder(wallet, ticket, signal)
  await keyMatches(wallet, funding.key, signal)
  const tx = fundingTx(funding)
  if (!tx.merklePath || !funding.observation) throw Error('Locally verified funding mining evidence is required.')
  if (funding.observation.txid !== tx.id('hex') || !verifyMiningAnchor(funding.observation, snapshot))
    throw Error('Funding mining block is not verified against local headers.')
  const observedProof = MerklePath.fromHex(funding.observation.merklePath!)
  if (
    tx.merklePath.blockHeight !== observedProof.blockHeight ||
    tx.merklePath.computeRoot(funding.txid!) !== observedProof.computeRoot(funding.txid!)
  )
    throw Error('Funding proof differs from the observed mining proof.')
  const report = await verifySigningEvidence(readSigningEvidenceBytes(funding.txid!, fromBase64(funding.beef!)), snapshot)
  if (!report.subjectMined) throw Error('Mined funding is required.')
  if (funding.txid === ticket.pkg.current.txid) throw Error('Fee funding must be a separate transaction.')
  await checkHolder(wallet, ticket, signal)
  await keyMatches(wallet, funding.key, signal)
  signal.throwIfAborted()
}
class WalletTransferMismatch extends Error {}
const abortTimeout = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
// Lets the wallet build and record the transfer (createAction noSend, then
// signAction). Returns 'fallback' only while no signature exists; after the
// first signature the wallet action is never cancelled, because the signed
// bytes may already have been recorded.
async function walletManagedTransfer(
  record: SenderRecord,
  request: HandoffRequest,
  wallet: Signer,
  ticketInput: Transaction,
  feeInput: Transaction,
  signal: AbortSignal,
): Promise<{ tx: Transaction; recorded: boolean } | 'fallback'> {
  if (typeof wallet.createAction !== 'function' || typeof wallet.signAction !== 'function') return 'fallback'
  const funding = record.funding!,
    pkg = record.ticket.pkg
  const ticketOutpoint = `${pkg.current.txid}.${pkg.current.index}`,
    feeOutpoint = `${funding.txid}.${funding.index}`
  const script = ticketScript(pkg.issuance.eventId, pkg.issuance.ticketId, pkg.issuance.origin, request.request)
  const inputBEEF = new Beef()
  inputBEEF.mergeBeef(fromBase64(pkg.atomicBeefBase64))
  inputBEEF.mergeBeef(fromBase64(funding.beef!))
  let created: Awaited<ReturnType<WalletInterface['createAction']>>
  try {
    created = await read(
      () =>
        wallet.createAction!({
          description: 'Transfer TicketSV ticket',
          labels: ['ticketsv-handoff'],
          inputBEEF: inputBEEF.toBinary(),
          inputs: [
            { outpoint: ticketOutpoint, inputDescription: 'TicketSV ticket being handed off', unlockingScriptLength: UNLOCK_LENGTH },
            { outpoint: feeOutpoint, inputDescription: 'Dedicated TicketSV handoff fee', unlockingScriptLength: UNLOCK_LENGTH },
          ],
          outputs: [{ lockingScript: script.toHex(), satoshis: 1, outputDescription: 'TicketSV ticket for its next holder' }],
          options: { noSend: true, signAndProcess: false, randomizeOutputs: false, returnTXIDOnly: false },
        }),
      signal,
    )
  } catch {
    signal.throwIfAborted()
    return 'fallback'
  }
  const reference = created?.signableTransaction?.reference
  // Only an unsigned action is cancelled; the wallet also fails it after five minutes.
  const abort = async () => {
    if (reference && typeof wallet.abortAction === 'function')
      await Promise.race([wallet.abortAction({ reference }).catch(() => undefined), abortTimeout(10_000)])
  }
  if (!reference || !created.signableTransaction?.tx) return 'fallback'
  const outpoint = (input: Transaction['inputs'][number]) =>
    `${input.sourceTXID ?? input.sourceTransaction?.id('hex')}.${input.sourceOutputIndex}`
  let tx: Transaction
  try {
    tx = Transaction.fromAtomicBEEF(created.signableTransaction.tx)
    const spent = tx.inputs.map(outpoint)
    // Any wallet-added input or change would change what C prepared to verify offline.
    if (
      tx.inputs.length !== 2 ||
      !spent.includes(ticketOutpoint) ||
      !spent.includes(feeOutpoint) ||
      tx.outputs.length !== 1 ||
      tx.outputs[0].satoshis !== 1 ||
      tx.outputs[0].lockingScript.toHex() !== script.toHex()
    ) {
      await abort()
      return 'fallback'
    }
    // BSV Desktop returns each parent as a raw transaction without its mining proof. Use TicketSV's proven copies of the
    // same two transactions, so the signed transfer verifies, and travels, with its proofs.
    for (const input of tx.inputs) input.sourceTransaction = outpoint(input) === ticketOutpoint ? ticketInput : feeInput
    await checkHolder(wallet, record.ticket, signal)
    await keyMatches(wallet, funding.key, signal)
  } catch (error) {
    await abort()
    throw error
  }
  for (let index = 0; index < tx.inputs.length; index++) {
    const key = outpoint(tx.inputs[index]) === ticketOutpoint ? pkg.request.recipient : funding.key
    await checkHolder(wallet, record.ticket, signal)
    await keyMatches(wallet, funding.key, signal)
    tx.inputs[index].unlockingScript = await read(
      () => new PushDrop(wallet as WalletInterface).unlock(key.protocolID, key.keyID, key.counterparty, 'all', false).sign(tx, index),
      signal,
    )
  }
  const spends = Object.fromEntries(tx.inputs.map((input, index) => [index, { unlockingScript: input.unlockingScript!.toHex() }]))
  let recorded = false
  try {
    const signed = await read(() => wallet.signAction!({ reference, spends, options: { noSend: true, returnTXIDOnly: false } }), signal)
    if (signed?.txid !== undefined && signed.txid !== tx.id('hex'))
      throw new WalletTransferMismatch('The wallet recorded a different transaction.')
    recorded = true
  } catch (error) {
    // A lost signAction response leaves the locally signed bytes intact.
    if (error instanceof WalletTransferMismatch) throw error
    signal.throwIfAborted()
  }
  return { tx, recorded }
}
export async function signHandoff(
  record: SenderRecord,
  value: HandoffRequest,
  wallet: Signer,
  snapshot: HeaderSnapshot | undefined,
  signal: AbortSignal,
  store: RecordStore<SenderRecord>,
  report?: (recorded: boolean) => void,
): Promise<SenderRecord> {
  record = readSender(record)
  await freshRecord(record, store)
  if (record.transfer || record.signAttempt?.outcome === 'complete')
    throw Error('Signing was already attempted; signed bytes cannot be revoked or retried.')
  const request = readHandoffRequest(value)
  if (record.signAttempt?.walletAsked === false) record = await write(store, record, { signAttempt: undefined, request: undefined })
  else if (record.signAttempt && !same(record.request, request))
    throw Error(
      `This ticket can only be signed again for the same recipient (request ${record.request!.request.requestId.slice(0, 8)}). A signature for them may already exist.`,
    )
  if (!same(request.invitation, invitationFor(record.ticket, request.invitation.requiredHeight)))
    throw Error('Receiving request does not match this source, event or trusted venue.')
  if (request.request.recipient.publicKey === record.ticket.pkg.request.recipient.publicKey)
    throw Error('Use a different receiving key for the new holder.')
  await prepareSigning(record, wallet, snapshot, signal)
  const funding = record.funding!,
    pkg = record.ticket.pkg
  const requiredHeight = Math.max(
    readSigningEvidenceBytes(pkg.current.txid, fromBase64(pkg.atomicBeefBase64)).requiredHeight,
    readSigningEvidenceBytes(funding.txid!, fromBase64(funding.beef!)).requiredHeight,
  )
  if (request.invitation.requiredHeight !== undefined && request.invitation.requiredHeight < requiredHeight)
    throw Error(
      'The invitation header height is below the actual input requirements. Prepare a new receiving request with current funding headers.',
    )
  const ticketInput = Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64)),
    feeInput = fundingTx(funding)
  let tx = new Transaction(
    1,
    [
      { sourceTransaction: ticketInput, sourceOutputIndex: pkg.current.index, sequence: 0xffffffff },
      { sourceTransaction: feeInput, sourceOutputIndex: funding.index!, sequence: 0xffffffff },
    ],
    [{ satoshis: 1, lockingScript: ticketScript(pkg.issuance.eventId, pkg.issuance.ticketId, pkg.issuance.origin, request.request) }],
    0,
  )
  // Reserve before either signature. The claim belongs to the source, not this request.
  const attempt = { id: crypto.randomUUID(), outcome: 'pending' as const, startedAt: new Date().toISOString(), walletAsked: false }
  signal.throwIfAborted()
  let claimed = await write(store, record, { request, signAttempt: attempt }),
    asked = false
  try {
    await prepareSigning(record, wallet, snapshot, signal)
    // Saved before any wallet call that builds or signs, so a lost answer is never mistaken for none.
    claimed = await write(store, claimed, { signAttempt: { ...attempt, walletAsked: true } })
    asked = true
    const managed = await walletManagedTransfer(record, request, wallet, ticketInput, feeInput, signal)
    if (managed === 'fallback') {
      const keys = [pkg.request.recipient, funding.key]
      for (let index = 0; index < keys.length; index++) {
        await checkHolder(wallet, record.ticket, signal)
        await keyMatches(wallet, funding.key, signal)
        const key = keys[index]
        tx.inputs[index].unlockingScript = await read(
          () => new PushDrop(wallet as WalletInterface).unlock(key.protocolID, key.keyID, key.counterparty, 'all', false).sign(tx, index),
          signal,
        )
      }
    } else tx = managed.tx
    const recorded = managed !== 'fallback' && managed.recorded
    await checkHolder(wallet, record.ticket, signal)
    await keyMatches(wallet, funding.key, signal)
    const size = tx.toBinary().length
    if (size > 4096) throw Error('Signed transfer exceeds the reviewed 4096-byte budget.')
    checkPolicy({ rawBytes: size, fee: funding.amount }, funding.policy)
    if (!(await tx.verify('scripts only'))) throw Error('Signed handoff transaction scripts failed verification.')
    const nextPackage = readTicketPackage(
      JSON.stringify({
        ...pkg,
        current: { txid: tx.id('hex'), index: 0 },
        request: request.request,
        lineageRawTxs: [...pkg.lineageRawTxs, tx.toHex()],
        atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()),
      }),
    )
    const transfer = readHandoffTicket({
      ...record.ticket,
      holder: request.recipientIdentity,
      pkg: nextPackage,
      request,
      savedAt: new Date().toISOString(),
    })
    const verified = await verifyHandoffTicket(transfer, snapshot)
    if (verified.verdict !== 'verified')
      throw Error(
        'Signed handoff package failed local verification: ' +
          verified.checks
            .filter(c => c.status !== 'pass')
            .map(c => c.reason)
            .join('; '),
      )
    signal.throwIfAborted()
    const done = await finish(store, record.id, attempt.id, 'signAttempt', 'complete', { transfer })
    if (done.signAttempt?.outcome === 'complete') report?.(recorded)
    return done
  } catch (error) {
    if (asked) return finish(store, record.id, attempt.id, 'signAttempt', 'unknown', {}, failureReason(error))
    // Nothing was signed, so release the ticket. If this save fails, the next attempt releases it.
    const current = await store.load(record.id).catch(() => undefined)
    if (current?.signAttempt?.id === attempt.id)
      await write(store, current, { signAttempt: undefined, request: undefined }).catch(() => undefined)
    throw error
  }
}
