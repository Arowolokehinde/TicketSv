import { describe, expect, it, vi } from 'vitest'
import { fundedForSigning } from './helpers/sender-release-fixture.ts'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { groupByAccount, handoffNextStep, removalPlan, statusLabel, storageState, ticketStatus } from '../src/offline/home.ts'
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
    expect(handoffNextStep({ recipient: { ...recipient, ticket: undefined } })).toBe('Waiting for the ticket')
    expect(handoffNextStep({ recipient })).toBe('Verify mining')
    expect(handoffNextStep({ recipient: { ...recipient, ticket: mined.ticket } })).toBe('Add to wallet')
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
