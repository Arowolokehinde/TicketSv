import type { NextStep } from './receive-steps.ts'
import type { SenderRecord } from './types.ts'

// What the sender should do next once Prepare is shown. A ticket whose signing ended without a saved
// transfer can never be signed again on this device, so it must not invite a recipient.
export type SendNext = { kind: 'invite' } | { kind: 'signed' } | { kind: 'blocked'; outcome: string; reason?: string } | undefined

export function sendNext(sender: Pick<SenderRecord, 'signAttempt' | 'transfer'> | undefined, invitationReady: boolean): SendNext {
  if (sender?.transfer) return { kind: 'signed' }
  const attempt = sender?.signAttempt
  if (attempt) return { kind: 'blocked', outcome: attempt.outcome, ...(attempt.reason ? { reason: attempt.reason } : {}) }
  return invitationReady ? { kind: 'invite' } : undefined
}

// The Next box on Prepare and Send. Nothing is suggested while an outcome needs review.
export function transferNext(
  tab: 'prepare' | 'send',
  sender: Pick<SenderRecord, 'fundAttempt' | 'signAttempt' | 'transfer'> | undefined,
  invitationReady: boolean,
  requestLoaded: boolean,
): NextStep | undefined {
  const signing = sendNext(sender, invitationReady)
  if (signing?.kind === 'blocked') return undefined
  if (tab === 'send') {
    if (signing?.kind === 'signed')
      return {
        done: 'Transfer signed and saved',
        next: "Show it to the recipient: Show ticket QR, then Show to scanner. Once you're both back online, continue to confirmation.",
      }
    if (sender?.fundAttempt?.outcome !== 'complete') return undefined
    return requestLoaded
      ? { done: 'Receiving request loaded', next: 'Check the summary, tick the consent, then select Sign offline transfer.' }
      : { next: "Load the recipient's receiving request: tap Scan receiving request QR, or load their file." }
  }
  if (signing?.kind === 'signed')
    return { done: 'Transfer signed', next: 'This ticket is signed and saved. Continue to Send to share it with the recipient.' }
  if (!sender?.fundAttempt) return { next: 'Review and prepare the transfer fee. It needs internet.' }
  if (sender.fundAttempt.outcome !== 'complete') return undefined
  return signing?.kind === 'invite'
    ? {
        done: 'Ready for offline transfer',
        next: 'Share the invitation with the recipient. When they send back their receiving request, continue to Send.',
      }
    : { done: 'Transfer fee prepared', next: 'Once the fee is mined, in about 10 minutes, select Check mining and prepare device.' }
}
