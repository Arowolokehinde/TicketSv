import { expect, it, vi } from 'vitest'
import type { RelinquishOutputArgs, WalletInterface } from '@bsv/sdk'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { memory, releaseSnapshot, senderReleaseFixture, walletFor } from './helpers/sender-release-fixture.ts'
import { newSettlement } from '../src/handoff/settlement.ts'
import {
  checkSpentOutputs,
  readSenderRelease,
  recheckRelease,
  releaseEligibility,
  releaseSpentOutputs,
  type SenderRelease,
} from '../src/handoff/release.ts'

// Only the synthetic header boundary is replaced; signatures, BEEF and script verification remain real.
vi.mock('../src/headers/tracker.ts', async original => ({
  ...(await original<object>()),
  createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }),
}))
vi.mock('../src/settlement/evidence.ts', async original => ({ ...(await original<object>()), verifyMiningAnchor: () => true }))
const signal = () => new AbortController().signal

// A wallet whose two TicketSV baskets are explicit sets; relinquishing removes an outpoint.
function releasingWallet(
  f: Awaited<ReturnType<typeof senderReleaseFixture>>,
  relinquish?: (args: RelinquishOutputArgs) => Promise<unknown>,
) {
  const baskets: Record<string, Set<string>> = {
    'ticketsv-tickets': new Set([f.ticketOutpoint]),
    'ticketsv-handoff-fees': new Set([f.feeOutpoint]),
  }
  const calls: string[] = []
  const wallet = f.wallet
  wallet.listOutputs = async args => {
    const outputs = [...(baskets[args.basket] ?? [])].map(outpoint => ({ outpoint, satoshis: 1, spendable: true }))
    return { totalOutputs: outputs.length, outputs }
  }
  wallet.relinquishOutput = async args => {
    calls.push(`${args.basket} ${args.output}`)
    if (relinquish) await relinquish(args)
    baskets[args.basket].delete(args.output)
    return { relinquished: true }
  }
  return { wallet, baskets, calls }
}
function releaseStore() {
  return memory<SenderRelease>(readSenderRelease)
}

it('eligibility returns the exact ticket and fee targets', async () => {
  const f = await senderReleaseFixture(),
    result = await releaseEligibility(f.signed, f.settlement, releaseSnapshot)
  expect(result.targets).toEqual([
    { basket: 'ticketsv-tickets', outpoint: f.ticketOutpoint },
    { basket: 'ticketsv-handoff-fees', outpoint: f.feeOutpoint },
  ])
  expect(result.transferTxid).toBe(f.signed.transfer!.pkg.current.txid)
})
it('eligibility refuses unmined, missing headers, other transfer or unsigned sender', async () => {
  const f = await senderReleaseFixture(),
    other = await handoffFixture(true)
  await expect(releaseEligibility(f.signed, f.unminedSettlement, releaseSnapshot)).rejects.toThrow(/mining|mined/i)
  await expect(releaseEligibility(f.signed, f.settlement, undefined)).rejects.toThrow(/headers/i)
  await expect(releaseEligibility(f.signed, newSettlement(other.ticket), releaseSnapshot)).rejects.toThrow(/transfer/i)
  await expect(releaseEligibility(f.funded, f.settlement, releaseSnapshot)).rejects.toThrow(/signed/i)
})
it('releases ticket then fee and confirms both absent', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore()
  const { wallet, calls } = releasingWallet(f, async args => {
    const saved = store.value(`${f.signed.id}`)!
    expect(saved.outputs.find(o => o.outpoint === args.output)!.attempts.at(-1)?.outcome).toBe('pending')
  })
  const result = await releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)
  expect(calls).toEqual([`ticketsv-tickets ${f.ticketOutpoint}`, `ticketsv-handoff-fees ${f.feeOutpoint}`])
  for (const output of result.outputs) {
    expect(output.attempts.map(a => a.outcome)).toEqual(['complete'])
    expect(output.observation?.state).toBe('absent')
  }
})
it('already absent outputs are not relinquished', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    { wallet, baskets, calls } = releasingWallet(f)
  baskets['ticketsv-tickets'].clear()
  baskets['ticketsv-handoff-fees'].clear()
  const result = await releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)
  expect(calls).toEqual([])
  expect(result.outputs.map(o => [o.observation?.state, o.attempts.length])).toEqual([
    ['absent', 0],
    ['absent', 0],
  ])
})
it('failed ticket release leaves fee untouched and allows an approved retry', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore()
  let fail = true
  const { wallet, calls } = releasingWallet(f, async () => {
    if (fail) {
      fail = false
      throw Error('Permission denied')
    }
  })
  const first = await releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)
  expect(first.outputs[0].attempts.map(a => a.outcome)).toEqual(['unknown'])
  expect(first.outputs[0].observation?.state).toBe('listed')
  expect(first.outputs[1].attempts).toEqual([])
  expect(calls).toHaveLength(1)
  const second = await releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)
  expect(second.outputs[0].attempts.map(a => a.outcome)).toEqual(['unknown', 'complete'])
  expect(second.outputs.map(o => o.observation?.state)).toEqual(['absent', 'absent'])
})
it('inconclusive observation blocks release', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    { wallet, calls } = releasingWallet(f)
  wallet.listOutputs = async () => ({ totalOutputs: 2, outputs: [{ outpoint: 'bad', satoshis: 1, spendable: true }] })
  await expect(releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)).rejects.toThrow(
    /inconclusive|records/i,
  )
  expect(calls).toEqual([])
})
it('cancellation leaves the attempt unknown and is never retried automatically', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    controller = new AbortController()
  const { wallet, calls } = releasingWallet(f, () => new Promise(() => {}))
  const pending = releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, controller.signal, store)
  await vi.waitFor(() => expect(calls).toHaveLength(1))
  controller.abort()
  const result = await pending
  expect(result.outputs[0].attempts.map(a => a.outcome)).toEqual(['unknown'])
  expect(calls).toHaveLength(1)
})
it('identity change prevents any wallet mutation', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    { wallet, calls } = releasingWallet(f),
    stranger = walletFor(9)
  wallet.getPublicKey = stranger.getPublicKey.bind(stranger)
  await expect(releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)).rejects.toThrow(/identity|holder/i)
  expect(calls).toEqual([])
})
it('does not call the wallet when the pending claim cannot be saved', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    { wallet, calls } = releasingWallet(f),
    save = store.save
  store.save = async (next, expected) => {
    if (next.outputs.some(o => o.attempts.some(a => a.outcome === 'pending'))) throw Error('Revision conflict')
    return save(next, expected)
  }
  await expect(releaseSpentOutputs(f.signed, f.settlement, wallet, releaseSnapshot, signal(), store)).rejects.toThrow(/conflict/i)
  expect(calls).toEqual([])
})
it('recheck finishes a stale pending attempt as unknown', async () => {
  const f = await senderReleaseFixture(),
    store = releaseStore(),
    { wallet, calls } = releasingWallet(f),
    eligible = await releaseEligibility(f.signed, f.settlement, releaseSnapshot)
  const startedAt = new Date().toISOString()
  await store.save(
    readSenderRelease({
      kind: 'ticketsv-sender-release',
      version: 1,
      id: f.signed.id,
      revision: 0,
      transferTxid: eligible.transferTxid,
      verifiedAt: startedAt,
      snapshotId: eligible.snapshotId,
      outputs: [
        { ...eligible.targets[0], attempts: [{ id: 'stale-attempt', outcome: 'pending', startedAt }] },
        { ...eligible.targets[1], attempts: [] },
      ],
    }),
    undefined,
  )
  const result = await recheckRelease(f.signed, wallet as WalletInterface, signal(), store)
  expect(result?.outputs[0].attempts.map(a => a.outcome)).toEqual(['unknown'])
  expect(result?.outputs.map(o => o.observation?.state)).toEqual(['listed', 'listed'])
  expect(calls).toEqual([])
})
it('release record history cannot be rewritten', () => {
  const startedAt = new Date().toISOString(),
    outpoint = `${'ab'.repeat(32)}.0`,
    fee = `${'cd'.repeat(32)}.1`
  const base = {
    kind: 'ticketsv-sender-release',
    version: 1,
    id: 'holder:testnet:source.0',
    revision: 0,
    transferTxid: 'ef'.repeat(32),
    verifiedAt: startedAt,
    snapshotId: 'snapshot',
    outputs: [
      { basket: 'ticketsv-tickets', outpoint, attempts: [{ id: 'a1', outcome: 'complete', startedAt, finishedAt: startedAt }] },
      { basket: 'ticketsv-handoff-fees', outpoint: fee, attempts: [] },
    ],
  }
  const saved = readSenderRelease(base),
    next = (patch: object) => ({ ...base, revision: 1, ...patch })
  expect(() =>
    readSenderRelease(next({ outputs: [{ ...base.outputs[0], outpoint: `${'aa'.repeat(32)}.0` }, base.outputs[1]] }), saved),
  ).toThrow(/change|outpoint/i)
  expect(() => readSenderRelease(next({ outputs: [{ ...base.outputs[0], attempts: [] }, base.outputs[1]] }), saved)).toThrow(/attempt/i)
  expect(() =>
    readSenderRelease(
      next({ outputs: [{ ...base.outputs[0], attempts: [{ id: 'a1', outcome: 'pending', startedAt }] }, base.outputs[1]] }),
      saved,
    ),
  ).toThrow(/attempt/i)
})

it('checks the wallet read-only: reports listed and absent outputs and removes nothing', async () => {
  const f = await senderReleaseFixture(),
    w = releasingWallet(f)
  expect((await checkSpentOutputs(f.signed, w.wallet, signal())).map(o => o.state)).toEqual(['listed', 'listed'])
  w.baskets['ticketsv-tickets'].clear()
  w.baskets['ticketsv-handoff-fees'].clear()
  expect((await checkSpentOutputs(f.signed, w.wallet, signal())).map(o => o.state)).toEqual(['absent', 'absent'])
  expect(w.calls).toEqual([])
})
