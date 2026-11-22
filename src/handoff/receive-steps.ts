// The receiver's steps, in order, from what is saved on this phone. Display only.
export type ReceiveFacts = {
  invitation: boolean
  organiserChecked: boolean
  requiredHeight?: number
  snapshotTip?: number
  request: boolean
  // The phone can't see the sender scan the request, so the receiver says so.
  shown: boolean
  ticket: boolean
  verdict?: string
  confirmed: boolean
}
export type StepKey = 'invitation' | 'organiser' | 'prepared' | 'request' | 'shown' | 'ticket' | 'verified' | 'confirmed'
export type ReceiveStep = { key: StepKey; label: string; state: 'done' | 'waiting' | 'todo'; detail: string }

const block = (height: number) => height.toLocaleString('en-US')

export function receiveSteps(f: ReceiveFacts): { items: ReceiveStep[]; current: StepKey | undefined } {
  const prepared = f.confirmed || (f.requiredHeight !== undefined && f.snapshotTip !== undefined && f.snapshotTip >= f.requiredHeight)
  const items: ReceiveStep[] = [
    f.invitation || f.request
      ? { key: 'invitation', label: 'Invitation loaded', state: 'done', detail: "The sender's invitation is on this phone." }
      : { key: 'invitation', label: 'Invitation loaded', state: 'todo', detail: "Scan or load the sender's invitation." },
    f.organiserChecked || f.request
      ? { key: 'organiser', label: 'Organiser checked', state: 'done', detail: 'Matches the published organiser identity.' }
      : { key: 'organiser', label: 'Organiser checked', state: 'todo', detail: 'Check the published event and save the organiser review.' },
    prepared
      ? {
          key: 'prepared',
          label: 'Device prepared online',
          state: 'done',
          detail: f.snapshotTip === undefined ? 'Prepared.' : `Block headers saved through block ${block(f.snapshotTip)}.`,
        }
      : {
          key: 'prepared',
          label: 'Device prepared online',
          state: 'todo',
          detail:
            f.invitation && f.requiredHeight === undefined
              ? 'This invitation has no header height. Ask the sender for a newer invitation, made after fee preparation.'
              : 'Saves block headers so this phone can check the ticket without internet. Needs internet.',
        },
    f.request
      ? { key: 'request', label: 'Receiving request created', state: 'done', detail: 'Saved on this phone.' }
      : {
          key: 'request',
          label: 'Receiving request created',
          state: 'todo',
          detail: 'Approve the receiving-key and identity signatures. No transaction is created.',
        },
    f.shown || f.ticket
      ? { key: 'shown', label: 'Request shown to the sender', state: 'done', detail: 'The sender has your request.' }
      : f.request
        ? { key: 'shown', label: 'Request shown to the sender', state: 'waiting', detail: 'Show your request to the sender, by QR or file.' }
        : { key: 'shown', label: 'Request shown to the sender', state: 'todo', detail: 'After your request is created.' },
    f.ticket
      ? { key: 'ticket', label: 'Ticket received from the sender', state: 'done', detail: "The sender's signed ticket is saved on this phone." }
      : f.request && f.shown
        ? {
            key: 'ticket',
            label: 'Ticket received from the sender',
            state: 'waiting',
            detail: 'Scan the ticket QR the sender shows you, or load their file.',
          }
        : { key: 'ticket', label: 'Ticket received from the sender', state: 'todo', detail: 'After the sender has your request.' },
    f.confirmed || f.verdict === 'verified'
      ? { key: 'verified', label: 'Ticket verified on this phone', state: 'done', detail: 'Checked on this phone, with no internet needed.' }
      : {
          key: 'verified',
          label: 'Ticket verified on this phone',
          state: 'todo',
          detail:
            f.verdict === 'incomplete'
              ? 'Some block headers are missing. Select Prepare missing headers online.'
              : f.verdict === 'rejected'
                ? 'The ticket failed a check. Do not accept it.'
                : 'Select Verify locally.',
        },
    f.confirmed
      ? { key: 'confirmed', label: 'Confirmed online', state: 'done', detail: 'The ticket is recorded in your wallet.' }
      : {
          key: 'confirmed',
          label: 'Confirmed online',
          state: 'todo',
          detail: "Once you're back online, on Confirm: publish the transfer, wait for mining, then add it to your wallet.",
        },
  ]
  // Preparing is optional once the request exists, as it always has been.
  const current = items.find(item => item.state !== 'done' && !(item.key === 'prepared' && f.request))?.key
  return { items, current }
}

export type NextStep = { done?: string; next: string }
const nextText: Partial<Record<StepKey, string>> = {
  invitation: "Scan or load the sender's invitation.",
  organiser: 'Check the organiser and save your review.',
  prepared: 'Prepare this device online. It needs internet.',
  request: 'Create your receiving request.',
  shown: 'Show your request to the sender, by QR or file.',
  ticket: 'Ask the sender to open Send and tap Show ticket QR, then Show to scanner. Then tap Scan ticket QR.',
  confirmed: "Once you're back online, continue to confirmation: publish the transfer, wait for mining, then add it to your wallet.",
}
// The Next box: the step just finished, and the one thing to do now.
export function receiveNext({ items, current }: ReturnType<typeof receiveSteps>): NextStep | undefined {
  const index = items.findIndex(item => item.key === current)
  if (index < 0) return undefined
  const done = items
    .slice(0, index)
    .reverse()
    .find(item => item.state === 'done')?.label
  // Verification follows its own result, so reuse the step's detail.
  const next = nextText[items[index].key] ?? items[index].detail
  return done ? { done, next } : { next }
}
