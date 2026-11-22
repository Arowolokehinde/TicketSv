import { describe, expect, it } from 'vitest'
import { conflictFixture } from './helpers/conflict-fixture.ts'
import { admissionKey, admit, doorDecision, readAdmission, refuse, savedSpend, type SpendCheck } from '../src/scanner/admissions.ts'
import { readSpentList } from '../src/scanner/store.ts'

const at = '2026-11-18T19:42:00.000Z'
const unspent: SpendCheck = { state: 'unspent', source: 'live' }
async function copies() {
  const f = await conflictFixture()
  return { a: f.pair.a.pkg, b: f.pair.b.pkg }
}

describe('door admissions', () => {
  it('identifies both copies of a double-sold ticket as the same ticket', async () => {
    const { a, b } = await copies()
    expect(admissionKey('conflict-event', a)).toBe(`conflict-event:${a.issuance.origin.txid}.${a.issuance.origin.index}`)
    expect(admissionKey('conflict-event', b)).toBe(admissionKey('conflict-event', a))
  })
  it('keeps events apart', async () => {
    const { a } = await copies()
    expect(admissionKey('other-event', a)).not.toBe(admissionKey('conflict-event', a))
  })
  it('admits only mined tickets', async () => {
    const { a } = await copies()
    expect(doorDecision('rejected', undefined, a, unspent)).toEqual({ kind: 'not-admissible' })
    expect(doorDecision('incomplete', undefined, a, unspent)).toEqual({ kind: 'not-admissible' })
    expect(doorDecision('passes-poc-policy', undefined, a, unspent)).toEqual({ kind: 'admit', mined: true })
    expect(doorDecision('online-check-required', undefined, a, unspent)).toEqual({ kind: 'needs-mining' })
  })
  it('admits a mined ticket only when its output is known to be unspent', async () => {
    const { a } = await copies()
    expect(doorDecision('passes-poc-policy', undefined, a, { state: 'spent', source: 'live', by: 'ff'.repeat(32) })).toEqual({
      kind: 'transferred',
      by: 'ff'.repeat(32),
    })
    expect(doorDecision('passes-poc-policy', undefined, a, { state: 'unknown', source: 'none' })).toEqual({ kind: 'unchecked' })
    expect(doorDecision('online-check-required', undefined, a, { state: 'unknown', source: 'none' })).toEqual({ kind: 'needs-mining' })
    expect(doorDecision('rejected', undefined, a, { state: 'spent', source: 'live' })).toEqual({ kind: 'not-admissible' })
  })
  it('still says already admitted when the admitted ticket is rescanned after it was spent', async () => {
    const { a } = await copies(),
      record = admit(undefined, 'conflict-event', a, true, at)
    expect(doorDecision('passes-poc-policy', record, a, { state: 'spent', source: 'live' })).toEqual({
      kind: 'already-admitted',
      at,
      differentCopy: false,
    })
  })
  it('reads the saved spent list for a ticket', async () => {
    const { a } = await copies(),
      origin = `${a.issuance.origin.txid}.${a.issuance.origin.index}`,
      current = `${a.current.txid}.${a.current.index}`,
      list = { id: 'conflict-event', revision: 0, checkedAt: at, tickets: [origin], spent: [origin] }
    expect(savedSpend(undefined, a)).toEqual({ state: 'unknown', source: 'none' })
    expect(savedSpend({ ...list, tickets: [] }, a)).toEqual({ state: 'unknown', source: 'saved', checkedAt: at })
    expect(savedSpend(list, a)).toEqual({ state: 'unspent', source: 'saved', checkedAt: at })
    expect(savedSpend({ ...list, spent: [origin, current] }, a)).toEqual({ state: 'spent', source: 'saved', checkedAt: at })
    expect(savedSpend({ ...list, id: 'other-event' }, a)).toEqual({ state: 'unknown', source: 'none' })
  })
  it('rejects a malformed saved spent list', () => {
    const good = { id: 'conflict-event', revision: 0, checkedAt: at, tickets: ['aa'.repeat(32) + '.0'], spent: [] }
    expect(readSpentList(good)).toEqual(good)
    expect(() => readSpentList({ ...good, spent: ['nope'] })).toThrow('Saved spent list is invalid.')
    expect(() => readSpentList({ ...good, checkedAt: 'x' })).toThrow('Saved spent list is invalid.')
  })
  it('refuses any later copy, and says when it is a different copy', async () => {
    const { a, b } = await copies(),
      record = admit(undefined, 'conflict-event', a, false, at)
    expect(doorDecision('online-check-required', record, a, unspent)).toEqual({ kind: 'already-admitted', at, differentCopy: false })
    expect(doorDecision('online-check-required', record, b, unspent)).toEqual({ kind: 'already-admitted', at, differentCopy: true })
    expect(doorDecision('rejected', record, b, unspent)).toEqual({ kind: 'not-admissible' })
  })
  it('saves the admitted copy and records each refused copy once', async () => {
    const { a, b } = await copies(),
      first = admit(undefined, 'conflict-event', a, false, at)
    expect(first).toMatchObject({
      id: admissionKey('conflict-event', a),
      revision: 0,
      eventId: 'conflict-event',
      admittedAt: at,
      admitted: { txid: a.current.txid, index: a.current.index, mined: false },
      refused: [],
    })
    const once = refuse(first, b, '2026-11-18T19:50:00.000Z'),
      twice = refuse(once, b, '2026-11-18T19:55:00.000Z')
    expect(once.refused.map(copy => copy.txid)).toEqual([b.current.txid])
    expect(twice).toBe(once)
    expect(refuse(first, a, at)).toBe(first)
  })
  it('never lets a saved admission change its admitted copy or drop refused copies', async () => {
    const { a, b } = await copies(),
      first = admit(undefined, 'conflict-event', a, false, at),
      refused = refuse(first, b, at)
    expect(readAdmission(JSON.parse(JSON.stringify(refused)), first)).toEqual(refused)
    expect(() => readAdmission({ ...refused, revision: 2, refused: [] }, refused)).toThrow('A refused copy cannot be removed.')
    expect(() =>
      readAdmission(
        { ...refused, revision: 2, admitted: { ...refused.admitted, txid: b.current.txid, index: b.current.index, pkg: b } },
        refused,
      ),
    ).toThrow('The admitted copy cannot change.')
    expect(() => readAdmission({ ...refused, id: 'other-event:x' })).toThrow('Saved door admission is invalid.')
  })
})
