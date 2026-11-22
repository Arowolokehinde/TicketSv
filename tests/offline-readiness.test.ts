import { describe, expect, it, vi } from 'vitest'
import { fundedForSigning } from './helpers/sender-release-fixture.ts'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { offlineReadiness, readinessFacts, type ReadinessEnvironment, type ReadinessFacts } from '../src/handoff/readiness.ts'

// Only the synthetic header boundary is replaced; BEEF parsing and mining heights remain real.
vi.mock('../src/headers/tracker.ts', async original => ({
  ...(await original<object>()),
  createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }),
}))
vi.mock('../src/settlement/evidence.ts', async original => ({ ...(await original<object>()), verifyMiningAnchor: () => true }))

const mined: ReadinessFacts = { ticketMinedAt: 1762324, ticketNeeds: 1762324, fee: 'created', feeMinedAt: 1762325, feeNeeds: 1762325 }
const ready: ReadinessEnvironment = { snapshotTip: 1762400, app: 'ready', transport: 'desktop-http' }
const item = (facts: ReadinessFacts, env = ready) => Object.fromEntries(offlineReadiness(facts, env).items.map(i => [i.key, i]))

describe('offline readiness', () => {
  it('derives mining heights from the saved ticket and fee evidence', async () => {
    const { ticket, ready: feeMined, funded } = await fundedForSigning()
    expect(readinessFacts(ticket, feeMined)).toMatchObject({ fee: 'created', feeMinedAt: 1762325, feeNeeds: 1762325 })
    expect(readinessFacts(ticket, funded)).toMatchObject({ fee: 'created', feeMinedAt: undefined })
    expect(readinessFacts(ticket, undefined).fee).toBe('none')
    expect(readinessFacts(ticket, { ...funded, fundAttempt: { ...funded.fundAttempt!, outcome: 'unknown' } }).fee).toBe('review')
    expect(readinessFacts((await handoffFixture(true)).ticket).ticketMinedAt).toBe(1762324)
    expect(readinessFacts((await handoffFixture(false)).ticket).ticketMinedAt).toBeUndefined()
  })
  it('is ready only when every requirement is met', () => {
    const result = offlineReadiness(mined, ready)
    expect(result.ready).toBe(true)
    expect(result.items.filter(i => i.state !== 'note').every(i => i.state === 'done')).toBe(true)
    expect(item(mined)['ticket-mined'].detail).toContain('1,762,324')
  })
  it('waits for an unmined ticket and its headers', () => {
    const facts: ReadinessFacts = { fee: 'none' }
    expect(offlineReadiness(facts, ready).ready).toBe(false)
    expect(item(facts)['ticket-mined']).toMatchObject({ state: 'waiting' })
    expect(item(facts)['ticket-mined'].detail).toMatch(/about 10 minutes/)
    expect(item(facts).headers.state).toBe('waiting')
    expect(item(facts)['fee-created'].state).toBe('todo')
    expect(item(facts)['fee-mined'].state).toBe('todo')
  })
  it('waits for the fee output after it is created', () => {
    const facts: ReadinessFacts = { ...mined, feeMinedAt: undefined, feeNeeds: undefined }
    expect(item(facts)['fee-created'].state).toBe('done')
    expect(item(facts)['fee-mined']).toMatchObject({ state: 'waiting' })
    expect(item(facts)['fee-mined'].detail).toMatch(/Check mining and prepare device/)
  })
  it('flags a fee attempt that needs review', () => {
    expect(item({ ...mined, fee: 'review' })['fee-created']).toMatchObject({ state: 'todo' })
    expect(item({ ...mined, fee: 'review' })['fee-created'].detail).toMatch(/review/i)
  })
  it('asks for headers through the highest required block', () => {
    const short = item(mined, { ...ready, snapshotTip: 1762324 }).headers
    expect(short.state).toBe('todo')
    expect(short.detail).toContain('1,762,325')
    expect(item(mined, { ...ready, snapshotTip: undefined }).headers.state).toBe('todo')
  })
  it('reports the offline app and wallet', () => {
    expect(item(mined, { ...ready, app: 'waiting' }).app.state).toBe('waiting')
    expect(item(mined, { ...ready, app: 'missing' }).app.state).toBe('todo')
    expect(item(mined, { ...ready, app: 'unknown' }).app.state).toBe('todo')
    expect(item(mined).wallet).toMatchObject({ state: 'note' })
    expect(item(mined).wallet.detail).toContain('BSV Desktop')
    expect(item(mined, { ...ready, transport: 'browser-native' }).wallet.detail).toContain('BSV Browser')
  })
  it('notes whether the browser keeps saved data without blocking readiness', () => {
    expect(item(mined, { ...ready, storage: true }).storage).toMatchObject({ state: 'note', detail: 'Kept on this device.' })
    expect(item(mined, { ...ready, storage: false }).storage.detail).toContain('may clear')
    expect(item(mined).storage.detail).toContain('does not say')
    expect(offlineReadiness(mined, { ...ready, storage: false }).ready).toBe(true)
  })
  it('tells a browser that cannot reopen offline to keep the page open', () => {
    const app = item(mined, { ...ready, app: 'unsupported' }).app
    expect(app.state).toBe('note')
    expect(app.detail).toBe(
      "This browser cannot reopen TicketSV without internet. Keep this page open and don't reload it until you're back online.",
    )
  })
  it('never names wallet versions', () => {
    for (const transport of ['desktop-http', 'desktop-https', 'browser-native'] as const)
      for (const i of offlineReadiness({ fee: 'none' }, { ...ready, transport }).items)
        expect(`${i.label} ${i.detail}`).not.toMatch(/\d+\.\d+\.\d+/)
  })
})
describe('offline readiness panel', () => {
  it('lists what a newly received ticket still needs', async () => {
    const { createElement } = await import('react'),
      { renderToStaticMarkup } = await import('react-dom/server')
    const { OfflineReadiness } = await import('../src/ui/OfflineReadiness.tsx')
    const html = renderToStaticMarkup(
      createElement(OfflineReadiness, { ticket: (await handoffFixture(false)).ticket, transport: 'desktop-http', busy: false }),
    )
    expect(html).toContain('Before you go offline')
    expect(html).toContain('Waiting for mining')
    expect(html).toContain('Select Review fee preparation below.')
  })
})
