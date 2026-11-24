import { expect, it, vi } from 'vitest'
import { Beef, LockingScript, MerklePath, Transaction, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk'
import { fundedForSigning, memory, releaseSnapshot, walletFor } from './helpers/sender-release-fixture.ts'
import { fundingCandidate, prepareSigning, signHandoff, walletTransactionSize, walletWindowAmount } from '../src/handoff/wallet.ts'
import { verifyHandoffTicket } from '../src/handoff/evidence.ts'
import { readSender } from '../src/handoff/store.ts'
import { ticketScript } from '../src/tickets/script.ts'
import type { SenderRecord } from '../src/handoff/types.ts'

// Only the synthetic header boundary is replaced; signatures, BEEF and script verification remain real.
vi.mock('../src/headers/tracker.ts', async original => ({
  ...(await original<object>()),
  createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }),
}))
vi.mock('../src/settlement/evidence.ts', async original => ({ ...(await original<object>()), verifyMiningAnchor: () => true }))
const signal = () => new AbortController().signal
const minedProof = (txid: string, height: number) =>
  new MerklePath(height, [
    [
      { offset: 1, hash: txid, txid: true },
      { offset: 0, hash: '11'.repeat(32) },
    ],
  ])

// A ready record whose dedicated fee output was funded at the legacy 5-satoshi ARC budget.
async function legacyFunded() {
  const f = await fundedForSigning(),
    funding = f.ready.funding!
  const feeScript = Transaction.fromAtomicBEEF(Utils.toArray(funding.beef!, 'base64')).outputs[funding.index!].lockingScript
  const parent = new Transaction(1, [], [{ satoshis: 100, lockingScript: LockingScript.fromASM('OP_TRUE') }])
  parent.merklePath = minedProof(parent.id('hex'), 1762324)
  const tx = new Transaction(
    1,
    [{ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() }],
    [{ satoshis: 5, lockingScript: feeScript }],
  )
  const legacy = {
    ...funding,
    amount: 5,
    txid: tx.id('hex'),
    beef: Utils.toBase64(tx.toAtomicBEEF()),
    index: 0,
    rawReceipt: { txid: tx.id('hex') },
    observation: undefined,
  }
  const observation = {
    txid: tx.id('hex'),
    txStatus: 'MINED' as const,
    observedAt: new Date().toISOString(),
    blockHeight: 1762325,
    blockHash: '22'.repeat(32),
    merklePath: minedProof(tx.id('hex'), 1762325).toHex(),
  }
  const ready = readSender({ ...f.ready, revision: 0, funding: fundingCandidate(legacy, observation) })
  return { ...f, ready, store: memory<SenderRecord>(readSender, ready) }
}

it('fee window covers the wallet fee without change', async () => {
  const { ticket } = await fundedForSigning(),
    amount = walletWindowAmount(ticket)
  const script = ticketScript(ticket.pkg.issuance.eventId, ticket.pkg.issuance.ticketId, ticket.pkg.issuance.origin, {
    ...ticket.pkg.request,
    requestId: '00000000-0000-4000-8000-000000000000',
    recipient: { ...ticket.pkg.request.recipient, keyID: '00000000-0000-4000-8000-000000000000' },
  })
  const size = walletTransactionSize([74, 74], [script.toBinary().length]),
    fee = Math.ceil((size / 1000) * 250)
  expect(walletTransactionSize([107], [25])).toBe(192)
  expect(amount).toBe(fee + 48)
  expect(amount - Math.ceil(((size + 34) / 1000) * 250)).toBeLessThan(96)
  expect(amount).toBeLessThanOrEqual(1000)
})
it('new fee reviews use the wallet window amount', async () => {
  const f = await fundedForSigning()
  expect(f.ready.funding!.amount).toBe(walletWindowAmount(f.ticket))
})
it('legacy funded amount still prepares for signing', async () => {
  const f = await legacyFunded()
  expect(f.ready.funding!.amount).toBe(5)
  await expect(prepareSigning(f.ready, f.wallet as WalletInterface, releaseSnapshot, signal())).resolves.toBeUndefined()
})

type Mode = 'exact' | 'extra-input' | 'change' | 'no-sources' | 'raw-parents' | 'throws' | 'hangs' | 'identity'
type Signing = 'ok' | 'throws' | 'other-txid'
// Emulates wallet-toolbox for the transfer action: an unsigned noSend transaction
// from the supplied inputs and outputs. At the wallet's fee rate (BSV Desktop
// 250 sat/kB, BSV Browser 100 sat/kB) it adds one of its own inputs when the
// explicit inputs are short, and a change output when the surplus reaches dust.
function actionWallet(f: Awaited<ReturnType<typeof fundedForSigning>>, mode: Mode, signing: Signing = 'ok', rate = 250) {
  const log: string[] = [],
    aborted: string[] = [],
    wallet = f.wallet,
    sign = wallet.createSignature.bind(wallet),
    identity = wallet.getPublicKey.bind(wallet)
  const stranger = walletFor(9)
  let built: Transaction | undefined
  wallet.createSignature = async args => {
    log.push('createSignature')
    return sign(args)
  }
  wallet.createAction = async args => {
    log.push('createAction')
    expect(f.store.value(f.ready.id)?.signAttempt?.outcome).toBe('pending')
    if (mode === 'throws') throw Error('Wallet refused')
    if (mode === 'hangs') return new Promise(() => {})
    const beef = Beef.fromBinary(args.inputBEEF!)
    const inputs = args.inputs!.map(i => {
      const [txid, vout] = i.outpoint.split('.')
      return {
        sourceTransaction: beef.findAtomicTransaction(txid)!,
        sourceOutputIndex: Number(vout),
        unlockingScript: new UnlockingScript(),
        sequence: 0xffffffff,
      }
    })
    const outputs = args.outputs!.map(o => ({ satoshis: o.satoshis, lockingScript: LockingScript.fromHex(o.lockingScript) }))
    const funded =
      inputs.reduce((n, i) => n + i.sourceTransaction.outputs[i.sourceOutputIndex].satoshis!, 0) -
      outputs.reduce((n, o) => n + o.satoshis, 0)
    const size = walletTransactionSize(
        args.inputs!.map(i => i.unlockingScriptLength!),
        outputs.map(o => o.lockingScript.toBinary().length),
      ),
      needed = Math.ceil((size / 1000) * rate)
    // Surplus that can pay for a change output and still reach the dust floor becomes change.
    const changeSurplus = funded - Math.ceil(((size + 34) / 1000) * rate) >= Math.max(1, Math.ceil((192 / 1000) * rate) * 2)
    if (mode === 'extra-input' || funded < needed) {
      const parent = new Transaction(1, [], [{ satoshis: 500, lockingScript: LockingScript.fromASM('OP_TRUE') }])
      parent.merklePath = minedProof(parent.id('hex'), 1762324)
      inputs.push({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript(), sequence: 0xffffffff })
    }
    if (mode === 'change' || (funded >= needed && changeSurplus))
      outputs.push({ satoshis: 40, lockingScript: LockingScript.fromASM('OP_TRUE') })
    built = new Transaction(1, inputs, outputs, 0)
    if (mode === 'identity') wallet.getPublicKey = stranger.getPublicKey.bind(stranger)
    // BSV Desktop 3.3.1's makeSignableTransactionBeef: each input's raw source transaction, without its mining proof.
    if (mode === 'raw-parents') {
      const raw = new Beef()
      for (const input of built.inputs) raw.mergeRawTx(input.sourceTransaction!.toBinary())
      raw.mergeRawTx(built.toBinary())
      return { signableTransaction: { tx: raw.toBinaryAtomic(built.id('hex')), reference: 'ref-1' } }
    }
    if (mode === 'no-sources') {
      const only = new Beef()
      only.mergeRawTx(built.toBinary())
      return { signableTransaction: { tx: only.toBinaryAtomic(built.id('hex')), reference: 'ref-1' } }
    }
    return { signableTransaction: { tx: built.toAtomicBEEF(), reference: 'ref-1' } }
  }
  wallet.signAction = async args => {
    log.push('signAction')
    if (signing === 'throws') throw Error('Wallet response lost')
    const tx = Transaction.fromAtomicBEEF(built!.toAtomicBEEF())
    for (const [i, spend] of Object.entries(args.spends))
      tx.inputs[Number(i)].unlockingScript = UnlockingScript.fromHex(spend.unlockingScript!)
    return { txid: signing === 'other-txid' ? 'ab'.repeat(32) : tx.id('hex') }
  }
  wallet.abortAction = async args => {
    log.push('abortAction')
    aborted.push(args.reference)
    return { aborted: true }
  }
  return { wallet, log, aborted, identity, spends: () => built }
}
async function signWith(f: Awaited<ReturnType<typeof fundedForSigning>>, wallet: WalletInterface, controller = new AbortController()) {
  const reports: boolean[] = []
  const result = await signHandoff(f.ready, f.request, wallet, releaseSnapshot, controller.signal, f.store, recorded =>
    reports.push(recorded),
  )
  return { result, reports }
}
const transferTx = (r: SenderRecord) => Transaction.fromAtomicBEEF(Utils.toArray(r.transfer!.pkg.atomicBeefBase64, 'base64'))
const spentOutpoints = (tx: Transaction) => tx.inputs.map(i => `${i.sourceTXID ?? i.sourceTransaction!.id('hex')}.${i.sourceOutputIndex}`)
const expectedInputs = (f: Awaited<ReturnType<typeof fundedForSigning>>) => [
  `${f.ticket.pkg.current.txid}.${f.ticket.pkg.current.index}`,
  `${f.ready.funding!.txid}.${f.ready.funding!.index}`,
]

it('exact wallet transaction is recorded by the wallet', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'exact')
  const { result, reports } = await signWith(f, w.wallet)
  expect(w.log).toEqual(['createAction', 'createSignature', 'createSignature', 'signAction'])
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([true])
  const tx = transferTx(result)
  expect(spentOutpoints(tx)).toEqual(expectedInputs(f))
  expect(tx.outputs).toHaveLength(1)
  expect(await tx.verify('scripts only')).toBe(true)
  expect((await verifyHandoffTicket(result.transfer!, releaseSnapshot)).verdict).not.toBe('rejected')
})
it('a wallet that returns raw parents without mining proofs, as BSV Desktop 3.3.1 does, still completes', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'raw-parents')
  const { result, reports } = await signWith(f, w.wallet)
  expect(w.log).toEqual(['createAction', 'createSignature', 'createSignature', 'signAction'])
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([true])
  const tx = transferTx(result)
  expect(spentOutpoints(tx)).toEqual(expectedInputs(f))
  // The saved transfer carries the parents' mining proofs, so the recipient can verify it offline.
  expect(tx.inputs.every(input => input.sourceTransaction?.merklePath)).toBe(true)
  expect((await verifyHandoffTicket(result.transfer!, releaseSnapshot)).verdict).not.toBe('rejected')
})
it.each(['extra-input', 'change'] as const)('%s is cancelled before signing and signed the standard way', async mode => {
  const f = await fundedForSigning(),
    w = actionWallet(f, mode)
  const { result, reports } = await signWith(f, w.wallet)
  expect(w.log.slice(0, 3)).toEqual(['createAction', 'abortAction', 'createSignature'])
  expect(w.aborted).toEqual(['ref-1'])
  expect(w.log).not.toContain('signAction')
  const tx = transferTx(result)
  expect(spentOutpoints(tx)).toEqual(expectedInputs(f))
  expect(tx.outputs).toHaveLength(1)
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
})
it('wallet without action methods signs the standard way', async () => {
  const f = await fundedForSigning(),
    { result, reports } = await signWith(f, f.wallet)
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
})
it('legacy fee takes the standard path', async () => {
  const f = await legacyFunded(),
    w = actionWallet(f, 'exact')
  const { result, reports } = await signWith(f, w.wallet)
  expect(w.aborted).toEqual(['ref-1'])
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
})
it('createAction refusal signs the standard way', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'throws'),
    { result, reports } = await signWith(f, w.wallet)
  expect(w.log).not.toContain('abortAction')
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
})
it('signAction failure after signatures completes from local bytes', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'exact', 'throws'),
    { result, reports } = await signWith(f, w.wallet)
  expect(w.log).not.toContain('abortAction')
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
  expect(spentOutpoints(transferTx(result))).toEqual(expectedInputs(f))
})
it('signAction returning another txid leaves the outcome unknown', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'exact', 'other-txid'),
    { result, reports } = await signWith(f, w.wallet)
  expect(result.signAttempt?.outcome).toBe('unknown')
  // The reason is kept, so the screen can say why instead of only "unknown".
  expect(result.signAttempt?.reason).toBe('The wallet recorded a different transaction.')
  expect(result.transfer).toBeUndefined()
  expect(w.log).not.toContain('abortAction')
  expect(reports).toEqual([])
})
it('an unknown attempt keeps a short reason; a pending one cannot carry one', async () => {
  const f = await fundedForSigning(),
    { result } = await signWith(f, actionWallet(f, 'exact', 'other-txid').wallet)
  const base = { id: 'a1', startedAt: new Date().toISOString() }
  const sender = (signAttempt: object) => ({ ...result, signAttempt })
  expect(
    readSender(sender({ ...base, outcome: 'unknown', finishedAt: base.startedAt, reason: 'x'.repeat(600) })).signAttempt?.reason,
  ).toHaveLength(300)
  expect(() => readSender(sender({ ...base, outcome: 'pending', reason: 'no' }))).toThrow('Invalid handoff attempt.')
  expect(() => readSender(sender({ ...base, outcome: 'unknown', finishedAt: base.startedAt, reason: 7 }))).toThrow(
    'Invalid handoff attempt.',
  )
})
it('identity change after createAction aborts before signing', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'identity'),
    { result } = await signWith(f, w.wallet)
  expect(w.aborted).toEqual(['ref-1'])
  expect(w.log).not.toContain('createSignature')
  expect(result.signAttempt?.outcome).toBe('unknown')
})
it('attaches input sources the wallet omitted', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'no-sources'),
    { result, reports } = await signWith(f, w.wallet)
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([true])
  expect(w.log).toContain('signAction')
})
it('cancellation during createAction never signs', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'hangs'),
    controller = new AbortController()
  const pending = signWith(f, w.wallet, controller)
  await vi.waitFor(() => expect(w.log).toContain('createAction'))
  controller.abort()
  const { result } = await pending
  expect(result.signAttempt?.outcome).toBe('unknown')
  expect(w.log).not.toContain('createSignature')
})
it('BSV Browser rate makes change from a Desktop-sized fee, so it signs the standard way', async () => {
  const f = await fundedForSigning(),
    w = actionWallet(f, 'exact', 'ok', 100)
  const { result, reports } = await signWith(f, w.wallet)
  expect(w.aborted).toEqual(['ref-1'])
  expect(w.log).not.toContain('signAction')
  expect(result.signAttempt?.outcome).toBe('complete')
  expect(reports).toEqual([false])
  expect(spentOutpoints(transferTx(result))).toEqual(expectedInputs(f))
})
