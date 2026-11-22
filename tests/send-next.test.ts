import { expect, it } from 'vitest'
import { sendNext, transferNext } from '../src/handoff/send-next.ts'

const attempt = (outcome: 'pending' | 'complete' | 'unknown', reason?: string) => ({
  id: 'a1',
  outcome,
  startedAt: '2026-11-20T10:00:00.000Z',
  ...(outcome === 'pending' ? {} : { finishedAt: '2026-11-20T10:00:05.000Z' }),
  ...(reason ? { reason } : {}),
})

it('invites the recipient only while the ticket can still be signed', () => {
  expect(sendNext(undefined, false)).toBeUndefined()
  expect(sendNext({}, false)).toBeUndefined()
  expect(sendNext({}, true)).toEqual({ kind: 'invite' })
})
it('points a signed ticket to Send instead of inviting again', () => {
  expect(sendNext({ signAttempt: attempt('complete'), transfer: {} as never }, true)).toEqual({ kind: 'signed' })
})
it('blocks a ticket whose signing ended without a saved transfer, with its reason', () => {
  expect(sendNext({ signAttempt: attempt('unknown', 'Wallet response lost') }, true)).toEqual({
    kind: 'blocked',
    outcome: 'unknown',
    reason: 'Wallet response lost',
  })
  expect(sendNext({ signAttempt: attempt('pending') }, true)).toEqual({ kind: 'blocked', outcome: 'pending' })
})

const complete = attempt('complete')
it('guides Prepare from fee review to Send', () => {
  expect(transferNext('prepare', {}, false, false)).toEqual({ next: 'Review and prepare the transfer fee. It needs internet.' })
  expect(transferNext('prepare', { fundAttempt: complete }, false, false)).toEqual({
    done: 'Transfer fee prepared',
    next: 'Once the fee is mined, in about 10 minutes, select Check mining and prepare device.',
  })
  expect(transferNext('prepare', { fundAttempt: complete }, true, false)).toEqual({
    done: 'Ready for offline transfer',
    next: 'Share the invitation with the recipient. When they send back their receiving request, continue to Send.',
  })
  expect(transferNext('prepare', { fundAttempt: complete, signAttempt: complete, transfer: {} as never }, true, false)).toEqual({
    done: 'Transfer signed',
    next: 'This ticket is signed and saved. Continue to Send to share it with the recipient.',
  })
})
it('guides Send from loading the request to showing the ticket', () => {
  expect(transferNext('send', { fundAttempt: complete }, true, false)).toEqual({
    next: "Load the recipient's receiving request: tap Scan receiving request QR, or load their file.",
  })
  expect(transferNext('send', { fundAttempt: complete }, true, true)).toEqual({
    done: 'Receiving request loaded',
    next: 'Check the summary, tick the consent, then select Sign offline transfer.',
  })
  expect(transferNext('send', { fundAttempt: complete, signAttempt: complete, transfer: {} as never }, true, false)).toEqual({
    done: 'Transfer signed and saved',
    next: "Show it to the recipient: Show ticket QR, then Show to scanner. Once you're both back online, continue to confirmation.",
  })
})
it('says nothing next when an outcome needs review or the ticket is blocked', () => {
  expect(transferNext('prepare', { fundAttempt: attempt('unknown') }, false, false)).toBeUndefined()
  expect(transferNext('prepare', { fundAttempt: complete, signAttempt: attempt('unknown') }, true, false)).toBeUndefined()
  expect(transferNext('send', { fundAttempt: complete, signAttempt: attempt('unknown') }, true, true)).toBeUndefined()
  expect(transferNext('send', undefined, false, false)).toBeUndefined()
})
