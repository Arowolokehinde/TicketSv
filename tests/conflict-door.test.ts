import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MerklePath } from '@bsv/sdk'
import { conflictFixture } from './helpers/conflict-fixture.ts'
import { doorVerdict, reviewConflictPair, verifyCompetingSpend } from '../src/conflicts/verify.ts'
import { minedCandidate } from '../src/settlement/evidence.ts'
import { scannerReview, verifyScannerTicket } from '../src/scanner/verify.ts'
import { makeSnapshot, parseProviderHeader, type HeaderRecord } from '../src/headers/validate.ts'
import checkpoint from './fixtures/headers/woc-1762324.json' with { type: 'json' }

// No verification stubs: a deterministic double sale whose issuance and branch
// A are in a block mined at testnet minimum difficulty after the real
// checkpoint (scripts/fixtures/mine-conflict-block.ts). Branch B is the loser.
const block = JSON.parse(readFileSync(new URL('./fixtures/conflict/mined-block.json', import.meta.url), 'utf8')) as {
  header: HeaderRecord
  issuanceTxid: string
  winnerTxid: string
  issuancePath: string
  winnerPath: string
}
const snapshot = makeSnapshot(
  [parseProviderHeader(checkpoint, 'whatsonchain', checkpoint.height), block.header],
  '2026-11-18T00:00:00.000Z',
)
const observed = (txid: string, merklePath = block.winnerPath) => ({
  txid,
  txStatus: 'MINED',
  observedAt: '2026-11-18T00:00:00.000Z',
  blockHeight: block.header.height,
  blockHash: block.header.hash,
  merklePath,
})
async function doubleSale() {
  const f = await conflictFixture()
  f.issuance.merklePath = MerklePath.fromHex(block.issuancePath)
  const pair = { a: await f.branch(f.a, 1), b: await f.branch(f.b, 2) }
  expect(pair.a.pkg.current.txid).toBe(block.winnerTxid) // The fixture must match the mined block.
  const review = scannerReview(
    {
      id: 'conflict-event',
      revision: 1,
      venueIdentity: f.trusted,
      name: 'Conflict event',
      date: '2030-01-01',
      time: '18:00',
      timezone: 'UTC',
      venue: 'Test hall',
      address: 'Test address',
      description: '',
    },
    'https://ticketsv.example',
  )
  return { f, pair, review }
}

describe('double sale at the door, full verification path', () => {
  it('verifies both signed branches offline, and admits neither without an online check', async () => {
    const { pair, review } = await doubleSale()
    const result = await reviewConflictPair(pair, snapshot)
    expect(result.verdict).toBe('verified')
    expect(doorVerdict(result.checks.a)).toBe('online-check-required')
    expect(doorVerdict(result.checks.b)).toBe('online-check-required')
    for (const branch of [pair.a, pair.b])
      expect((await verifyScannerTicket(branch.pkg, review, snapshot)).policy).toBe('online-check-required')
  })
  it('once branch A is mined, admits A and identifies B as the losing spend', async () => {
    const { pair, review } = await doubleSale()
    const verdict = await verifyCompetingSpend(pair, 'a', observed(block.winnerTxid), snapshot)
    expect(verdict).toMatchObject({
      verdict: 'conflicting-spend-mined-in-local-snapshot',
      winner: pair.a.pkg.current.txid,
      loser: pair.b.pkg.current.txid,
    })
    expect((await verifyScannerTicket(minedCandidate(pair.a, observed(block.winnerTxid)).pkg, review, snapshot)).policy).toBe(
      'passes-poc-policy',
    )
    expect((await verifyScannerTicket(pair.b.pkg, review, snapshot)).policy).toBe('online-check-required')
  })
  it('refuses to treat the loser as mined using the winner’s proof', async () => {
    const { pair } = await doubleSale()
    const verdict = await verifyCompetingSpend(pair, 'b', observed(pair.b.pkg.current.txid), snapshot)
    expect(verdict.verdict).not.toBe('conflicting-spend-mined-in-local-snapshot')
    expect(['rejected', 'incomplete']).toContain(verdict.verdict)
  })
  it('rejects a winner proof altered to a different Merkle root', async () => {
    const { pair } = await doubleSale(),
      proof = MerklePath.fromHex(block.winnerPath)
    proof.path[1][0].hash = (proof.path[1][0].hash!.startsWith('0') ? '1' : '0') + proof.path[1][0].hash!.slice(1)
    expect((await verifyCompetingSpend(pair, 'a', observed(block.winnerTxid, proof.toHex()), snapshot)).verdict).toBe('rejected')
  })
})
