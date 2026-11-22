import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MerklePath } from '@bsv/sdk'
import { conflictFixture } from './helpers/conflict-fixture.ts'
import { admit, refuse } from '../src/scanner/admissions.ts'
import { reconcileAdmission } from '../src/scanner/reconcile.ts'
import { makeSnapshot, parseProviderHeader, type HeaderRecord } from '../src/headers/validate.ts'
import type { ArcObservation } from '../src/settlement/types.ts'
import checkpoint from './fixtures/headers/woc-1762324.json' with { type: 'json' }

// Real verification: branch A of the double sale is in a block mined after the
// real checkpoint (tests/fixtures/conflict/mined-block.json); branch B is not.
const block = JSON.parse(readFileSync(new URL('./fixtures/conflict/mined-block.json', import.meta.url), 'utf8')) as {
  header: HeaderRecord
  winnerPath: string
  issuancePath: string
}
const snapshot = makeSnapshot(
  [parseProviderHeader(checkpoint, 'whatsonchain', checkpoint.height), block.header],
  '2026-11-18T00:00:00.000Z',
)
const at = '2026-11-18T19:42:00.000Z',
  now = '2026-11-18T21:00:00.000Z',
  signal = new AbortController().signal
const mined = (txid: string): ArcObservation => ({
  txid,
  txStatus: 'MINED',
  observedAt: now,
  blockHeight: block.header.height,
  blockHash: block.header.hash,
  merklePath: block.winnerPath,
})
async function doubleSale() {
  const f = await conflictFixture()
  f.issuance.merklePath = MerklePath.fromHex(block.issuancePath)
  return { trusted: f.trusted, a: (await f.branch(f.a, 1)).pkg, b: (await f.branch(f.b, 2)).pkg }
}
const status = (answers: Record<string, ArcObservation | undefined>) => async (txid: string) => answers[txid]

describe('reconciling the door once online', () => {
  it('flags an admitted copy that lost the double sale', async () => {
    const { trusted, a, b } = await doubleSale(),
      record = refuse(admit(undefined, 'conflict-event', b, false, at), a, at)
    const result = await reconcileAdmission(
      record,
      trusted,
      { status: status({ [a.current.txid]: mined(a.current.txid) }), snapshot },
      signal,
      now,
    )
    expect(result.reconcile).toMatchObject({ state: 'lost', winnerTxid: a.current.txid, checkedAt: now })
    expect(result.revision).toBe(record.revision + 1)
  })
  it('confirms an admitted copy proven mined', async () => {
    const { trusted, a, b } = await doubleSale(),
      record = refuse(admit(undefined, 'conflict-event', a, false, at), b, at)
    const result = await reconcileAdmission(
      record,
      trusted,
      { status: status({ [a.current.txid]: mined(a.current.txid) }), snapshot },
      signal,
      now,
    )
    expect(result.reconcile).toMatchObject({ state: 'confirmed' })
  })
  it('does not confirm on a proof that fails the headers', async () => {
    const { trusted, b } = await doubleSale(),
      record = admit(undefined, 'conflict-event', b, false, at)
    const result = await reconcileAdmission(
      record,
      trusted,
      { status: status({ [b.current.txid]: mined(b.current.txid) }), snapshot },
      signal,
      now,
    )
    expect(result.reconcile).toMatchObject({ state: 'waiting' })
  })
  it('waits while no copy is proven mined', async () => {
    const { trusted, a, b } = await doubleSale(),
      record = refuse(admit(undefined, 'conflict-event', b, false, at), a, at)
    expect((await reconcileAdmission(record, trusted, { status: status({}), snapshot }, signal, now)).reconcile).toMatchObject({
      state: 'waiting',
    })
  })
  it('marks unknown when ARC cannot be reached', async () => {
    const { trusted, b } = await doubleSale(),
      record = admit(undefined, 'conflict-event', b, false, at)
    const result = await reconcileAdmission(
      record,
      trusted,
      {
        status: async () => {
          throw Error('fetch failed')
        },
        snapshot,
      },
      signal,
      now,
    )
    expect(result.reconcile).toMatchObject({ state: 'unknown' })
    expect(result.admitted).toEqual(record.admitted)
  })
})
