import { describe, expect, it, vi } from 'vitest'
import { fundedForSigning } from './helpers/sender-release-fixture.ts'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import {
  groupByAccount,
  handoffNextStep,
  needsInternet,
  offlineReadiness,
  readinessText,
  removalPlan,
  statusLabel,
  storageState,
  ticketStatus,
} from '../src/offline/home.ts'
import { newSettlement, readSettlement, type HandoffSettlement } from '../src/handoff/settlement.ts'
import type { Attempt, RecipientRecord, SenderRecord } from '../src/handoff/types.ts'

// Only the synthetic header boundary is replaced; record logic and BEEF parsing are real.
vi.mock('../src/headers/tracker.ts', async original => ({
  ...(await original<object>()),
  createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }),
}))
vi.mock('../src/settlement/evidence.ts', async original => ({ ...(await original<object>()), verifyMiningAnchor: () => true }))

const attempt = (outcome: Attempt['outcome']): Attempt => ({
  id: crypto.randomUUID(),
  outcome,
  startedAt: '2026-11-18T10:00:00.000Z',
  ...(outcome === 'pending' ? {} : { finishedAt: '2026-11-18T10:01:00.000Z' }),
})
async function records() {
  const mined = await handoffFixture(true),
    unmined = await handoffFixture(false),
    f = await fundedForSigning()
  const recipient: RecipientRecord = {
    kind: 'ticketsv-handoff-recipient',
    version: 1,
    id: 'r1',
    revision: 0,
    request: unmined.request,
    ticket: unmined.ticket,
  }
  return { mined, unmined, f, recipient }
}

describe('offline home', () => {
  it('labels every ticket status', () => {
    expect(statusLabel).toEqual({
      current: 'Current',
      'sent-unpublished': 'Sent, not yet published',
      'sent-waiting': 'Sent, waiting for mining',
      sent: 'Sent',
      'received-unmined': 'Received, not yet mined',
      received: 'Received',
      'in-wallet': 'In your wallet',
    })
  })
  it('works out a received ticket’s status from its saved evidence', async () => {
    const { mined, unmined } = await records()
    expect(ticketStatus(unmined.ticket.pkg, { received: true })).toBe('received-unmined')
    expect(ticketStatus(mined.ticket.pkg, { received: true })).toBe('received')
    const inWallet = readSettlement({
      ...newSettlement(mined.ticket),
      wallet: { state: 'present', checkedAt: '2026-11-18T10:00:00.000Z', reason: 'Matching ticket output.' },
    })
    expect(ticketStatus(mined.ticket.pkg, { received: true, settlement: inWallet })).toBe('in-wallet')
  })
  it('marks a ticket this device handed on as sent, once its transfer is mined', async () => {
    const { mined, unmined, f } = await records()
    const sender: SenderRecord = { ...f.ready, signAttempt: attempt('complete'), transfer: unmined.ticket }
    expect(ticketStatus(f.ticket.pkg, { received: false })).toBe('current')
    expect(ticketStatus(f.ticket.pkg, { received: false, sender })).toBe('sent-unpublished')
    const published: HandoffSettlement = { ...newSettlement(unmined.ticket), submit: attempt('complete') }
    expect(ticketStatus(f.ticket.pkg, { received: false, sender, sentSettlement: published })).toBe('sent-waiting')
    expect(ticketStatus(f.ticket.pkg, { received: false, sender, sentSettlement: { ...published, ticket: mined.ticket } })).toBe('sent')
  })
  it('gives the next step for each stage of a handoff', async () => {
    const { mined, unmined, f, recipient } = await records()
    expect(handoffNextStep({ sender: { ...f.ready, fundAttempt: undefined, funding: undefined } })).toBe('Prepare transfer fee')
    expect(handoffNextStep({ sender: { ...f.funded, fundAttempt: attempt('unknown') } })).toBe('Fee preparation needs review')
    expect(handoffNextStep({ sender: f.funded })).toBe('Waiting for fee mining')
    expect(handoffNextStep({ sender: f.ready })).toBe('Sign offline transfer')
    const signed = { ...f.ready, signAttempt: attempt('complete'), transfer: unmined.ticket }
    expect(handoffNextStep({ sender: signed })).toBe('Publish transfer')
    expect(handoffNextStep({ sender: signed, settlement: { ...newSettlement(unmined.ticket), submit: attempt('unknown') } })).toBe(
      'Publication needs review',
    )
    expect(handoffNextStep({ sender: signed, settlement: { ...newSettlement(unmined.ticket), submit: attempt('complete') } })).toBe(
      'Verify mining',
    )
    expect(handoffNextStep({ sender: signed, settlement: { ...newSettlement(mined.ticket), submit: attempt('complete') } })).toBeNull()
    // Mined is final, whoever published it.
    expect(handoffNextStep({ sender: signed, settlement: newSettlement(mined.ticket) })).toBeNull()
    expect(handoffNextStep({ sender: { ...f.ready, signAttempt: attempt('unknown') } })).toBe('Retry signing for the same recipient')
    expect(handoffNextStep({ sender: { ...f.ready, signAttempt: attempt('pending') } })).toBe('Retry signing for the same recipient')
    expect(handoffNextStep({ recipient: { ...recipient, ticket: undefined } })).toBe('Waiting for the ticket')
    expect(handoffNextStep({ recipient })).toBe('Verify mining')
    expect(handoffNextStep({ recipient: { ...recipient, ticket: mined.ticket } })).toBe('Add to wallet')
  })
  it('says which next steps need internet', () => {
    for (const step of [
      'Prepare transfer fee',
      'Fee preparation needs review',
      'Waiting for fee mining',
      'Publish transfer',
      'Publication needs review',
      'Verify mining',
      'Wallet import needs review',
      'Add to wallet',
    ])
      expect(needsInternet(step)).toBe(true)
    for (const step of ['Sign offline transfer', 'Retry signing for the same recipient', 'Waiting for the ticket'])
      expect(needsInternet(step)).toBe(false)
  })
  it('works out what a held ticket can do offline from saved records and headers', async () => {
    const { mined, unmined, f } = await records()
    // The fixtures are first in block 1762324, so their headers are needed through 1762424 (maturity).
    expect(offlineReadiness(mined.ticket.pkg, undefined, 1762424).door).toBe('ready')
    expect(offlineReadiness(mined.ticket.pkg, undefined, 1762423).door).toBe('headers')
    expect(offlineReadiness(mined.ticket.pkg, undefined, undefined).door).toBe('headers')
    expect(offlineReadiness(unmined.ticket.pkg, undefined, 2000000).door).toBe('unmined')
    expect(offlineReadiness(f.ticket.pkg, undefined, 2000000).transfer).toBe('fee')
    expect(offlineReadiness(f.ticket.pkg, f.funded, 2000000).transfer).toBe('fee-mining')
    // Mined but not yet checked with Check mining and prepare device.
    expect(offlineReadiness(f.ticket.pkg, { ...f.ready, funding: { ...f.ready.funding!, observation: undefined } }, 2000000).transfer).toBe(
      'headers',
    )
    expect(offlineReadiness(f.ticket.pkg, f.ready, 1762423).transfer).toBe('headers')
    expect(offlineReadiness(f.ticket.pkg, f.ready, 2000000).transfer).toBe('ready')
    expect(offlineReadiness(f.ticket.pkg, { ...f.ready, signAttempt: attempt('unknown') }, 2000000).transfer).toBe('busy')
    expect(offlineReadiness(f.ticket.pkg, { ...f.ready, fundAttempt: attempt('unknown') }, 2000000).transfer).toBe('busy')
    expect(readinessText.door).toEqual({
      ready: 'Ready for the door',
      unmined: 'Not mined yet. The door admits only mined tickets.',
      headers: "Block headers for this ticket aren't saved. Needs internet.",
    })
    expect(readinessText.transfer).toEqual({
      ready: 'Ready to transfer offline',
      fee: 'Transfer needs internet first: prepare the transfer fee.',
      'fee-mining': 'Transfer needs internet first: wait for the fee to be mined.',
      headers: 'Transfer needs internet first: select Check mining and prepare device.',
    })
  })
  it('removes everything except unfinished or unknown steps', async () => {
    const { unmined, f, recipient } = await records()
    const finished = { ...f.ready, id: 's-done' },
      signing = { ...f.ready, id: 's-signing', signAttempt: attempt('pending') }
    const unpublished = { ...f.ready, id: 's-unpublished', signAttempt: attempt('complete'), transfer: unmined.ticket }
    const importing: HandoffSettlement = { ...newSettlement(unmined.ticket), import: attempt('unknown') }
    const plan = removalPlan({
      saved: ['saved-1'],
      senders: [finished, signing, unpublished],
      recipients: [recipient],
      settlements: [importing],
      releases: [],
    })
    expect(plan.remove.saved).toEqual(['saved-1'])
    expect(plan.remove.senders.map(s => s.id)).toEqual(['s-done'])
    expect(plan.keep.map(k => [k.id, k.reason])).toEqual([
      ['s-signing', 'A wallet step is unfinished or its outcome is unknown.'],
      ['s-unpublished', 'A signed transfer has not been published yet.'],
      [importing.id, 'A publication or wallet import is unfinished or its outcome is unknown.'],
      [recipient.id, 'Linked to a step that is still unfinished.'],
    ])
    expect(plan.remove.recipients).toEqual([])
    expect(plan.remove.settlements).toEqual([])
  })
  it('describes whether the browser keeps saved data', () => {
    expect(storageState(true, { usage: 3_250_000 }).text).toBe('Kept on this device · 3.3 MB used')
    expect(storageState(false).text).toBe('The browser may clear TicketSV’s data after a period without visits')
    expect(storageState(undefined).text).toBe('This browser does not say whether it keeps saved data')
  })
})

describe('grouping by wallet identity', () => {
  it('keeps two identities on one device in separate groups, saved tickets first', () => {
    const groups = groupByAccount(
      [
        { id: 's1', who: 'alice' },
        { id: 's2', who: 'bob' },
        { id: 'damaged', who: '' },
      ],
      [{ id: 'r1', who: 'bob' }],
      s => s.who,
      r => r.who,
    )
    expect([...groups.keys()]).toEqual(['alice', 'bob', ''])
    expect(groups.get('bob')).toEqual({ saved: [{ id: 's2', who: 'bob' }], received: [{ id: 'r1', who: 'bob' }] })
  })
})
