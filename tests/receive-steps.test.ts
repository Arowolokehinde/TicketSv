import { describe, expect, it } from 'vitest'
import { receiveNext, receiveSteps, type ReceiveFacts } from '../src/handoff/receive-steps.ts'

const none: ReceiveFacts = { invitation: false, organiserChecked: false, request: false, shown: false, ticket: false, confirmed: false }
const reviewed: ReceiveFacts = { ...none, invitation: true, organiserChecked: true, requiredHeight: 100 }
const state = (f: ReceiveFacts, key: string) => receiveSteps(f).items.find(item => item.key === key)!

describe('receive steps', () => {
  it('lists the receiver steps in order and starts with the invitation', () => {
    const steps = receiveSteps(none)
    expect(steps.items.map(item => item.label)).toEqual([
      'Invitation loaded',
      'Organiser checked',
      'Device prepared online',
      'Receiving request created',
      'Request shown to the sender',
      'Ticket received from the sender',
      'Ticket verified on this phone',
      'Confirmed online',
    ])
    expect(steps.current).toBe('invitation')
  })
  it('moves to preparation once the organiser is checked, and marks it done when headers reach the invitation', () => {
    expect(receiveSteps(reviewed).current).toBe('prepared')
    expect(state({ ...reviewed, snapshotTip: 99 }, 'prepared').state).toBe('todo')
    expect(state({ ...reviewed, snapshotTip: 100 }, 'prepared').state).toBe('done')
    expect(receiveSteps({ ...reviewed, snapshotTip: 100 }).current).toBe('request')
  })
  it('keeps preparation optional once the request exists', () => {
    const steps = receiveSteps({ ...reviewed, request: true })
    expect(steps.current).toBe('shown')
    expect(state({ ...reviewed, request: true }, 'prepared').state).toBe('todo')
  })
  it('waits for the receiver to show the request before asking for the ticket', () => {
    const saved = { ...reviewed, request: true }
    expect(state(saved, 'shown').state).toBe('waiting')
    expect(state(saved, 'ticket').state).toBe('todo')
    expect(receiveSteps({ ...saved, shown: true }).current).toBe('ticket')
    expect(state({ ...saved, shown: true }, 'ticket').state).toBe('waiting')
    // A received ticket means the request reached the sender, even after a reload.
    expect(state({ ...saved, ticket: true }, 'shown').state).toBe('done')
  })
  it('asks for a newer invitation when it has no header height', () => {
    expect(state({ ...reviewed, requiredHeight: undefined }, 'prepared').detail).toContain('Ask the sender for a newer invitation')
  })
  it('points an incomplete verification at preparing missing headers', () => {
    const f = { ...reviewed, request: true, ticket: true, verdict: 'incomplete' }
    expect(state(f, 'verified').state).toBe('todo')
    expect(state(f, 'verified').detail).toContain('Prepare missing headers online')
    expect(receiveSteps(f).current).toBe('verified')
    expect(receiveSteps({ ...f, verdict: 'verified' }).current).toBe('confirmed')
  })
  it('marks every step done once confirmed', () => {
    const steps = receiveSteps({ ...reviewed, snapshotTip: 100, request: true, ticket: true, verdict: 'verified', confirmed: true })
    expect(steps.items.every(item => item.state === 'done')).toBe(true)
    expect(steps.current).toBeUndefined()
  })
})

describe('receive next step', () => {
  const next = (f: ReceiveFacts) => receiveNext(receiveSteps(f))
  it('starts with the invitation and names nothing done', () => {
    expect(next(none)).toEqual({ next: "Scan or load the sender's invitation." })
  })
  it('names the step just finished and the one thing to do now', () => {
    expect(next(reviewed)).toEqual({ done: 'Organiser checked', next: 'Prepare this device online. It needs internet.' })
    expect(next({ ...reviewed, request: true })).toEqual({
      done: 'Receiving request created',
      next: 'Show your request to the sender, by QR or file.',
    })
    expect(next({ ...reviewed, request: true, shown: true })).toEqual({
      done: 'Request shown to the sender',
      next: 'Ask the sender to open Send and tap Show ticket QR, then Show to scanner. Then tap Scan ticket QR.',
    })
    expect(next({ ...reviewed, request: true, ticket: true })).toEqual({ done: 'Ticket received from the sender', next: 'Select Verify locally.' })
  })
  it('follows the verification result', () => {
    const received = { ...reviewed, request: true, ticket: true }
    expect(next({ ...received, verdict: 'incomplete' })?.next).toContain('Prepare missing headers online')
    expect(next({ ...received, verdict: 'verified' })).toEqual({
      done: 'Ticket verified on this phone',
      next: "Once you're back online, continue to confirmation: publish the transfer, wait for mining, then add it to your wallet.",
    })
  })
  it('has nothing next once confirmed', () => {
    expect(receiveNext(receiveSteps({ ...reviewed, request: true, ticket: true, verdict: 'verified', confirmed: true }))).toBeUndefined()
  })
})
