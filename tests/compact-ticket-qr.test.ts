import { expect, it } from 'vitest'
import { packCompactTicket, unpackCompactTicket } from '../src/handoff/compact-ticket.ts'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { fromAttendee } from '../src/handoff/evidence.ts'
it('restores original packages, attendee evidence and handoff envelopes with identical data', async () => {
  const f = await attendeeOfflineFixture('https://ticketsv.example'),
    e = attendeeEvidence(f.record, f.identity, 'https://ticketsv.example'),
    t = fromAttendee(e)
  for (const value of [f.record.pkg, e, t]) {
    const packed = packCompactTicket(value)
    expect(packed).not.toBeNull()
    expect(unpackCompactTicket(packed!)).toEqual(value)
  }
})
it('rejects malformed binary and refuses lossy packing of extra or altered fields', async () => {
  const f = await attendeeOfflineFixture(),
    pkg = f.record.pkg!
  expect(packCompactTicket({ ...pkg, extra: 'must not disappear' })).toBeNull()
  expect(packCompactTicket({ ...pkg, current: { ...pkg.current, index: 99 } })).toBeNull()
  for (const bytes of [new Uint8Array(), new Uint8Array([159]), new Uint8Array([129, 99, 65])])
    expect(() => unpackCompactTicket(bytes)).toThrow()
})

it('retains later lineage and original issuance proofs when the origin is absent from current BEEF', async () => {
  const { compactTicketFixture, extend } = await import('./helpers/compact-ticket-fixture.ts')
  const { transfer } = await compactTicketFixture()
  const later = await extend(transfer, 3, 4, true)
  for (const value of [transfer, later]) {
    const packed = packCompactTicket(value)
    expect(packed).toBeTruthy()
    expect(unpackCompactTicket(packed!)).toEqual(value)
  }
})
