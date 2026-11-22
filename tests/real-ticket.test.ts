import { describe, expect, it } from 'vitest'
import { Transaction, Utils } from '@bsv/sdk'
import { REAL_MINED_HEIGHT, REAL_TRANSFER_TXID, realSnapshot, realTicket } from './helpers/real-ticket.ts'
import { verifyHandoffTicket } from '../src/handoff/evidence.ts'
import { newSettlement, prepareObservedHandoffMining, readSettlement, type HandoffSettlement } from '../src/handoff/settlement.ts'
import { scannerReview, verifyScannerTicket } from '../src/scanner/verify.ts'
import { fromBase64 } from '../src/tickets/codec.ts'
import { memory } from './helpers/sender-release-fixture.ts'
import { evidenceSize } from '../src/tickets/size.ts'

// No verification stubs anywhere in this file: real ticket, real proofs, real headers.
const signal = () => new AbortController().signal
const minedProof = () => Transaction.fromAtomicBEEF(fromBase64(realTicket('mined').pkg.atomicBeefBase64)).merklePath!
const review = () => {
  const t = realTicket('mined')
  return scannerReview({ id: t.pkg.issuance.eventId, revision: 1, venueIdentity: t.trustedVenue, ...t.event }, t.origin)
}

describe('real mined ticket, full verification path', () => {
  it('verifies the real mined transfer against real headers', async () => {
    const report = await verifyHandoffTicket(realTicket('mined'), realSnapshot())
    expect(report.verdict).toBe('verified')
    expect(report.presentedTransferMined).toBe(true)
    expect(report.checks.every(check => check.status === 'pass')).toBe(true)
    expect(report.anchorHeights).toContain(REAL_MINED_HEIGHT)
  })
  it('verifies the same transfer before mining, without claiming it is mined', async () => {
    const report = await verifyHandoffTicket(realTicket('unmined'), realSnapshot())
    expect(report.verdict).toBe('verified')
    expect(report.presentedTransferMined).toBe(false)
  })
  it('is incomplete, never verified, when headers stop before the mining block', async () => {
    const report = await verifyHandoffTicket(realTicket('mined'), realSnapshot(REAL_MINED_HEIGHT - 1))
    expect(report.verdict).toBe('incomplete')
    expect(report.checks.find(check => check.name === 'anchors')?.status).toBe('incomplete')
  })
  it('rejects a mining proof that does not match the real header', async () => {
    const ticket = realTicket('mined'),
      tx = Transaction.fromAtomicBEEF(fromBase64(ticket.pkg.atomicBeefBase64))
    const leaf = tx.merklePath!.path[1][0]
    leaf.hash = (leaf.hash!.startsWith('0') ? '1' : '0') + leaf.hash!.slice(1)
    const report = await verifyHandoffTicket(
      { ...ticket, pkg: { ...ticket.pkg, atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) } },
      realSnapshot(),
    )
    expect(report.verdict).toBe('rejected')
    expect(report.checks.find(check => check.name === 'anchors')?.reason).toMatch(/does not match/)
  })
  it('refuses a handoff whose organiser signature no longer matches its saved original', async () => {
    const ticket = realTicket('mined'),
      signature = Utils.toArray(ticket.pkg.issuance.signatureBase64, 'base64')
    signature[10] ^= 1
    await expect(
      verifyHandoffTicket(
        { ...ticket, pkg: { ...ticket.pkg, issuance: { ...ticket.pkg.issuance, signatureBase64: Utils.toBase64(signature) } } },
        realSnapshot(),
      ),
    ).rejects.toThrow('Original issuance evidence changed.')
  })
})

describe('real ticket at the door', () => {
  it('admits the mined transfer under the PoC policy', async () => {
    const result = await verifyScannerTicket(realTicket('mined').pkg, review(), realSnapshot())
    expect(result.policy).toBe('passes-poc-policy')
  })
  it('rejects a changed organiser signature', async () => {
    const pkg = structuredClone(realTicket('mined').pkg),
      signature = Utils.toArray(pkg.issuance.signatureBase64, 'base64')
    signature[10] ^= 1
    pkg.issuance.signatureBase64 = Utils.toBase64(signature)
    const result = await verifyScannerTicket(pkg, review(), realSnapshot())
    expect(result.policy).toBe('rejected')
    expect(result.verification.checks.find(check => check.name === 'issuer')?.status).toBe('fail')
  })
  it('asks for an online check while the transfer is unmined', async () => {
    const result = await verifyScannerTicket(realTicket('unmined').pkg, review(), realSnapshot())
    expect(result.policy).toBe('online-check-required')
  })
})

describe('real handoff settlement', () => {
  const observed = (merklePath: string): HandoffSettlement =>
    readSettlement({
      ...newSettlement(realTicket('unmined')),
      status: {
        txid: REAL_TRANSFER_TXID,
        txStatus: 'MINED',
        observedAt: '2026-11-18T00:00:00.000Z',
        blockHeight: REAL_MINED_HEIGHT,
        blockHash: realSnapshot().headers.at(-1)!.hash,
        merklePath,
      },
    })
  it('turns a real MINED observation into verified mining evidence', async () => {
    const checked = observed(minedProof().toHex()),
      store = memory(readSettlement, checked)
    const result = await prepareObservedHandoffMining(checked, signal(), undefined, store, async () => realSnapshot())
    expect(result.preparationError).toBeUndefined()
    expect(result.verification).toMatchObject({ verdict: 'verified', presentedTransferMined: true })
    expect(Transaction.fromAtomicBEEF(fromBase64(result.settlement.ticket.pkg.atomicBeefBase64)).merklePath?.blockHeight).toBe(
      REAL_MINED_HEIGHT,
    )
    expect(result.settlement.unminedEvidence).toEqual(evidenceSize(realTicket('unmined').pkg))
    expect(evidenceSize(result.settlement.ticket.pkg)).toMatchObject({ transactions: 1, proofs: 1 })
  })
  it('never records an already-mined ticket as its size before mining', async () => {
    const mined = readSettlement({ ...observed(minedProof().toHex()), ticket: realTicket('mined'), id: newSettlement(realTicket('mined')).id }),
      store = memory(readSettlement, mined)
    const result = await prepareObservedHandoffMining(mined, signal(), undefined, store, async () => realSnapshot())
    expect(result.verification).toMatchObject({ verdict: 'verified' })
    expect(result.settlement.unminedEvidence).toBeUndefined()
  })
  it('keeps the transfer unverified when the observed proof does not match the real header', async () => {
    const proof = minedProof(),
      leaf = proof.path[1][0]
    leaf.hash = (leaf.hash!.startsWith('0') ? '1' : '0') + leaf.hash!.slice(1)
    const checked = observed(proof.toHex()),
      store = memory(readSettlement, checked)
    const result = await prepareObservedHandoffMining(checked, signal(), undefined, store, async () => realSnapshot())
    expect(result.verification).toBeUndefined()
    expect(result.preparationError).toBeTruthy()
  })
})
