import { Transaction } from '@bsv/sdk'
import { fromBase64 } from '../tickets/codec.ts'
import { settlementKey, type HandoffSettlement } from '../handoff/settlement.ts'
import type { Attempt, RecipientRecord, SenderRecord } from '../handoff/types.ts'
import type { SenderRelease } from '../handoff/release.ts'
import type { TicketPackage } from '../tickets/types.ts'
import { requiredHeaderHeight } from '../handoff/headers.ts'

// The offline home's view of this device's saved records. Every status and
// next step is worked out from saved evidence only, so it works offline, and
// never claims more than that evidence shows.
export type TicketStatus = 'current' | 'sent-unpublished' | 'sent-waiting' | 'sent' | 'received-unmined' | 'received' | 'in-wallet'
export const statusLabel: Record<TicketStatus, string> = {
  current: 'Current',
  'sent-unpublished': 'Sent, not yet published',
  'sent-waiting': 'Sent, waiting for mining',
  sent: 'Sent',
  'received-unmined': 'Received, not yet mined',
  received: 'Received',
  'in-wallet': 'In your wallet',
}

function minedEnvelope(txid: string | undefined, beef: string | undefined): boolean {
  if (!txid || !beef) return false
  try {
    const tx = Transaction.fromAtomicBEEF(fromBase64(beef))
    return tx.id('hex') === txid && Boolean(tx.merklePath)
  } catch {
    return false
  }
}
export const isMined = (pkg: TicketPackage): boolean => minedEnvelope(pkg.current.txid, pkg.atomicBeefBase64)
const unfinished = (attempt: Attempt | undefined) => attempt !== undefined && attempt.outcome !== 'complete'

export function ticketStatus(
  pkg: TicketPackage,
  context: { received: boolean; sender?: SenderRecord; sentSettlement?: HandoffSettlement; settlement?: HandoffSettlement },
): TicketStatus {
  if (context.sender?.transfer) {
    if (context.sentSettlement && isMined(context.sentSettlement.ticket.pkg)) return 'sent'
    return context.sentSettlement?.submit?.outcome === 'complete' ? 'sent-waiting' : 'sent-unpublished'
  }
  if (!context.received) return 'current'
  if (!isMined(context.settlement?.ticket.pkg ?? pkg)) return 'received-unmined'
  return context.settlement?.wallet?.state === 'present' ? 'in-wallet' : 'received'
}

export function handoffNextStep(record: {
  sender?: SenderRecord
  recipient?: RecipientRecord
  settlement?: HandoffSettlement
}): string | null {
  const { sender, recipient, settlement } = record
  if (sender) {
    if (!sender.fundAttempt) return 'Prepare transfer fee'
    if (unfinished(sender.fundAttempt)) return 'Fee preparation needs review'
    if (!minedEnvelope(sender.funding?.txid, sender.funding?.beef)) return 'Waiting for fee mining'
    if (!sender.signAttempt) return 'Sign offline transfer'
    if (unfinished(sender.signAttempt) || !sender.transfer) return 'Retry signing for the same recipient'
    // Mined is final, whoever published it.
    if (settlement && isMined(settlement.ticket.pkg)) return null
    if (!settlement?.submit) return 'Publish transfer'
    if (unfinished(settlement.submit)) return 'Publication needs review'
    return 'Verify mining'
  }
  if (recipient) {
    if (!recipient.ticket) return 'Waiting for the ticket'
    if (!isMined(settlement?.ticket.pkg ?? recipient.ticket.pkg)) return 'Verify mining'
    if (unfinished(settlement?.import)) return 'Wallet import needs review'
    return settlement?.wallet?.state === 'present' ? null : 'Add to wallet'
  }
  return null
}

const online = new Set([
  'Prepare transfer fee',
  'Fee preparation needs review',
  'Waiting for fee mining',
  'Publish transfer',
  'Publication needs review',
  'Verify mining',
  'Wallet import needs review',
  'Add to wallet',
])
export const needsInternet = (step: string): boolean => online.has(step)

// What a ticket this device holds can do offline, from saved records and the saved header tip.
// Transfer readiness matches the Transfer page's "Ready for offline transfer".
export type DoorReadiness = 'ready' | 'unmined' | 'headers'
export type TransferReadiness = 'ready' | 'fee' | 'fee-mining' | 'headers' | 'busy'
export const readinessText = {
  door: {
    ready: 'Ready for the door',
    unmined: 'Not mined yet. The door admits only mined tickets.',
    headers: "Block headers for this ticket aren't saved. Needs internet.",
  },
  transfer: {
    ready: 'Ready to transfer offline',
    fee: 'Transfer needs internet first: prepare the transfer fee.',
    'fee-mining': 'Transfer needs internet first: wait for the fee to be mined.',
    headers: 'Transfer needs internet first: select Check mining and prepare device.',
  },
} as const
function height(txid: string, beef: string): number | undefined {
  try {
    return requiredHeaderHeight(txid, beef)
  } catch {
    return undefined
  }
}
export function offlineReadiness(
  pkg: TicketPackage,
  sender: SenderRecord | undefined,
  tip: number | undefined,
): { door: DoorReadiness; transfer: TransferReadiness } {
  const covered = (h: number | undefined) => h !== undefined && tip !== undefined && tip >= h
  const ticketHeight = isMined(pkg) ? height(pkg.current.txid, pkg.atomicBeefBase64) : undefined
  const door: DoorReadiness = !isMined(pkg) ? 'unmined' : covered(ticketHeight) ? 'ready' : 'headers'
  const funding = sender?.funding
  const feeHeight = funding?.txid && funding.beef && minedEnvelope(funding.txid, funding.beef) ? height(funding.txid, funding.beef) : undefined
  const transfer: TransferReadiness =
    sender?.signAttempt || sender?.transfer
      ? 'busy'
      : !sender?.fundAttempt
        ? 'fee'
        : unfinished(sender.fundAttempt)
          ? 'busy'
          : feeHeight === undefined
            ? 'fee-mining'
            : funding?.observation && ticketHeight !== undefined && covered(Math.max(ticketHeight, feeHeight))
              ? 'ready'
              : 'headers'
  return { door, transfer }
}

type Records = {
  saved: string[]
  senders: SenderRecord[]
  recipients: RecipientRecord[]
  settlements: HandoffSettlement[]
  releases: SenderRelease[]
}
export type RemovalPlan = { remove: Records; keep: { id: string; reason: string }[] }
// "Remove all from this device" never deletes a record whose wallet, signing or
// broadcast step is unfinished or unknown: losing it could allow signing the
// same ticket twice or hide an outcome that still needs review.
export function removalPlan(records: Records): RemovalPlan {
  const keep: RemovalPlan['keep'] = []
  const senders = records.senders.filter(sender => {
    const reason =
      unfinished(sender.fundAttempt) || unfinished(sender.signAttempt)
        ? 'A wallet step is unfinished or its outcome is unknown.'
        : sender.transfer && !records.settlements.some(s => s.id === settlementKey(sender.transfer!) && s.submit?.outcome === 'complete')
          ? 'A signed transfer has not been published yet.'
          : undefined
    if (reason) keep.push({ id: sender.id, reason })
    return !reason
  })
  const keptSettlements = new Set<string>()
  const settlements = records.settlements.filter(settlement => {
    if (!unfinished(settlement.submit) && !unfinished(settlement.import)) return true
    keep.push({ id: settlement.id, reason: 'A publication or wallet import is unfinished or its outcome is unknown.' })
    keptSettlements.add(settlement.id)
    return false
  })
  const releases = records.releases.filter(release => {
    if (!release.outputs.some(output => output.attempts.some(a => a.outcome !== 'complete'))) return true
    keep.push({ id: release.id, reason: 'A wallet release is unfinished or its outcome is unknown.' })
    return false
  })
  const recipients = records.recipients.filter(recipient => {
    if (!recipient.ticket || !keptSettlements.has(settlementKey(recipient.ticket))) return true
    keep.push({ id: recipient.id, reason: 'Linked to a step that is still unfinished.' })
    return false
  })
  return { remove: { saved: records.saved, senders, recipients, settlements, releases }, keep }
}

export { storageState } from './persist.ts'
// Two people can use one device: each wallet identity's tickets stay together.
export function groupByAccount<S, R>(
  saved: S[],
  received: R[],
  savedAccount: (item: S) => string,
  receivedAccount: (item: R) => string,
): Map<string, { saved: S[]; received: R[] }> {
  const groups = new Map<string, { saved: S[]; received: R[] }>()
  const group = (key: string) => groups.get(key) ?? groups.set(key, { saved: [], received: [] }).get(key)!
  for (const item of saved) group(savedAccount(item)).saved.push(item)
  for (const item of received) group(receivedAccount(item)).received.push(item)
  return groups
}
