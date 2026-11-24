import { describe, expect, it } from 'vitest'
import { realTicket } from './helpers/real-ticket.ts'
import { evidenceSize, formatEvidence, evidenceChange } from '../src/tickets/size.ts'
import { newSettlement, readSettlement } from '../src/handoff/settlement.ts'

describe('ticket evidence size', () => {
  it('shrinks once the real transfer is mined: one transaction and its mining proof', () => {
    const before = evidenceSize(realTicket('unmined').pkg),
      after = evidenceSize(realTicket('mined').pkg)
    expect(after).toMatchObject({ transactions: 1, proofs: 1 })
    expect(before.transactions).toBeGreaterThan(1)
    expect(after.bytes).toBeLessThan(before.bytes)
  })
  it('formats size, transactions and proofs', () => {
    expect(formatEvidence({ bytes: 1946, transactions: 3, proofs: 2 })).toBe('1.9 KB · 3 transactions · 2 mining proofs')
    expect(formatEvidence({ bytes: 700, transactions: 1, proofs: 1 })).toBe('0.7 KB · 1 transaction · 1 mining proof')
    expect(formatEvidence({ bytes: 400, transactions: 1, proofs: 0 })).toBe('0.4 KB · 1 transaction · no mining proof')
  })
})
describe('evidence change after mining', () => {
  const before = { bytes: 1946, transactions: 3, proofs: 2 },
    after = { bytes: 820, transactions: 1, proofs: 1 }
  it('shows before and after once mined', () => {
    expect(evidenceChange(before, after)).toBe(
      'Ticket evidence: 1.9 KB · 3 transactions · 2 mining proofs → 0.8 KB · 1 transaction · 1 mining proof after mining. Earlier history is replaced by one mining proof.',
    )
  })
  it('shows only the current size without a saved size from before mining', () => {
    expect(evidenceChange(undefined, after)).toBe('Ticket evidence: 0.8 KB · 1 transaction · 1 mining proof.')
  })
})
describe('settlement evidence before mining', () => {
  const first = newSettlement(realTicket('unmined')),
    size = evidenceSize(first.ticket.pkg)
  it('accepts a record without it and keeps it once set', () => {
    expect(first.unminedEvidence).toBeUndefined()
    const saved = readSettlement({ ...first, revision: 1, unminedEvidence: size }, first)
    expect(saved.unminedEvidence).toEqual(size)
    expect(readSettlement({ ...saved, revision: 2 }, saved).unminedEvidence).toEqual(size)
    expect(() => readSettlement({ ...saved, revision: 2, unminedEvidence: { ...size, bytes: 1 } }, saved)).toThrow(
      'Signed transfer changed.',
    )
  })
  it('rejects invalid sizes', () => {
    expect(() => readSettlement({ ...first, unminedEvidence: { bytes: -1, transactions: 1, proofs: 0 } })).toThrow(
      'Invalid saved evidence size.',
    )
  })
})
