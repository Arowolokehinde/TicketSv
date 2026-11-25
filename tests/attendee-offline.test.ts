import { expect, it, vi } from 'vitest'
import { Transaction, Utils } from '@bsv/sdk'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import {
  attendeeEvidence,
  readAttendeeEvidence,
  verifyAttendeeEvidence,
  requireMinedEvidence,
  restoreAttendeeMiningEvidence,
} from '../src/offline/attendee-evidence.ts'
import type { HeaderSnapshot } from '../src/headers/validate.ts'
// Synthetic anchors only: replace SPV boundary, keep request/venue signatures,
// lineage, recipient binding and SDK scripts real. Real SPV remains separately tested.
vi.mock('../src/verification/signing-spv.ts', async original => ({
  ...(await original<object>()),
  verifySigningEvidence: async (e: { atomicBeef: number[] }, snapshot?: HeaderSnapshot) => {
    if (!snapshot) throw Error('Verification incomplete — required block header missing')
    return { subjectMined: !!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath }
  },
}))
const origin = 'http://127.0.0.1:4175'
const snapshot = { id: 'synthetic' } as HeaderSnapshot
it('restores only matching device mining evidence without treating it as a verdict', async () => {
  const { record, identity, tx } = await attendeeOfflineFixture()
  const saved = attendeeEvidence(record, identity, origin)
  tx.merklePath = undefined
  const original = { ...record, pkg: { ...record.pkg!, atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) } }
  const restored = restoreAttendeeMiningEvidence(original, saved, identity, origin)
  expect(restored.pkg).toEqual(record.pkg)
  expect(original.pkg.atomicBeefBase64).not.toBe(record.pkg!.atomicBeefBase64)
  expect((await verifyAttendeeEvidence(attendeeEvidence(restored, identity, origin), origin)).verdict).toBe('incomplete')
  expect(restoreAttendeeMiningEvidence(record, saved, identity, origin)).toBe(record)
  const other = await attendeeOfflineFixture()
  expect(() => restoreAttendeeMiningEvidence(original, attendeeEvidence(other.record, other.identity, origin), identity, origin)).toThrow(
    'Saved mining evidence does not match this delivery.',
  )
  expect(() => restoreAttendeeMiningEvidence(original, saved, record.owner, origin)).toThrow('Receiving request context changed.')
  expect(() => restoreAttendeeMiningEvidence(original, saved, identity, 'https://elsewhere.test')).toThrow(
    'Receiving request context changed.',
  )
  const tampered = structuredClone(saved)
  tampered.pkg.issuance.signatureBase64 = 'AAAA'
  expect(() => restoreAttendeeMiningEvidence(original, tampered, identity, origin)).toThrow(
    'Saved mining evidence does not match this delivery.',
  )
  const wrongBytes = structuredClone(saved)
  wrongBytes.pkg.atomicBeefBase64 = other.record.pkg!.atomicBeefBase64
  expect(() => restoreAttendeeMiningEvidence(original, wrongBytes, identity, origin)).toThrow('Incomplete or invalid Atomic BEEF')
})
it('binds a distinct attendee to the saved delivery and verifies locally', async () => {
  const { record, identity } = await attendeeOfflineFixture()
  const evidence = attendeeEvidence(record, identity, origin)
  expect(evidence.attendee).not.toBe(evidence.trustedVenue)
  const report = await verifyAttendeeEvidence(evidence, origin, snapshot)
  expect(report.verdict).toBe('verified')
  expect(report.presentedTransferMined).toBe(true)
  expect(() => requireMinedEvidence(report)).not.toThrow()
})
it('rejects a different account, origin, ticket, event or recipient before saving', async () => {
  const { record, identity } = await attendeeOfflineFixture()
  expect(() => attendeeEvidence(record, record.owner, origin)).toThrow('Receiving request context changed.')
  expect(() => attendeeEvidence(record, identity, 'https://elsewhere.test')).toThrow('Receiving request context changed.')
  for (const [patch, message] of [
    [{ id: crypto.randomUUID() }, 'Saved ticket does not match its original delivery.'],
    [{ eventId: crypto.randomUUID() }, 'Receiving request context changed.'],
    [{ eventRevision: 3 }, 'Receiving request context changed.'],
    [{ txid: 'ab'.repeat(32) }, 'A completed attendee delivery is required.'],
    [{ request: { ...record.request, requestId: crypto.randomUUID() } }, 'Invalid ticket package or receiving request'],
  ] as const) {
    expect(() => attendeeEvidence({ ...record, ...patch }, identity, origin)).toThrow(message)
  }
})
it('rejects changed proof signatures and corrupt saved records', async () => {
  const { record, identity } = await attendeeOfflineFixture()
  const evidence = attendeeEvidence(record, identity, origin)
  expect(() => readAttendeeEvidence({ ...evidence, proof: { ...evidence.proof, signature: 'AAAA' } }, origin)).toThrow(
    'Signature DER must start with 0x30',
  )
  expect(() => readAttendeeEvidence({ ...evidence, version: 2 }, origin)).toThrow('Invalid saved ticket context.')
  const bad = structuredClone(evidence)
  bad.pkg.issuance.signatureBase64 = 'AAAA'
  expect((await verifyAttendeeEvidence(bad, origin, snapshot)).verdict).toBe('rejected')
})
it('missing headers stay incomplete without fetching and cannot be saved as ready', async () => {
  const { record, identity } = await attendeeOfflineFixture(),
    fetch = vi.spyOn(globalThis, 'fetch')
  try {
    const report = await verifyAttendeeEvidence(attendeeEvidence(record, identity, origin), origin, undefined)
    expect(report.verdict).toBe('incomplete')
    expect(() => requireMinedEvidence(report)).toThrow(
      'Ticket evidence is not fully verified. Verify the ticket and resolve any failed or missing checks before saving.',
    )
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
})
it('unmined evidence may verify but cannot qualify for offline preparation', async () => {
  const { record, identity } = await attendeeOfflineFixture(origin, false)
  const report = await verifyAttendeeEvidence(attendeeEvidence(record, identity, origin), origin, snapshot)
  expect(report.verdict).toBe('verified')
  expect(report.presentedTransferMined).toBe(false)
  expect(() => requireMinedEvidence(report)).toThrow(/mining/i)
})
