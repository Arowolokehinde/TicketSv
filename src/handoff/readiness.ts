import { Transaction } from '@bsv/sdk'
import { fromBase64 } from '../tickets/codec.ts'
import { requiredHeaderHeight } from './headers.ts'
import type { HandoffTicket, SenderRecord } from './types.ts'
import type { WalletTransport } from '../wallet/connection.ts'

// What offline signing needs, read from saved evidence only: no wallet call and
// no network. The preparation actions themselves stay where they are.
export type ReadinessFacts = {
  ticketMinedAt?: number
  ticketNeeds?: number
  fee: 'none' | 'review' | 'created'
  feeMinedAt?: number
  feeNeeds?: number
}
export type ReadinessItem = {
  key: 'ticket-mined' | 'fee-created' | 'fee-mined' | 'headers' | 'app' | 'storage' | 'wallet'
  label: string
  state: 'done' | 'waiting' | 'todo' | 'note'
  detail: string
}
export type ReadinessEnvironment = {
  snapshotTip?: number
  app: 'ready' | 'waiting' | 'missing' | 'unknown' | 'unsupported'
  storage?: boolean
  transport: WalletTransport
}

function mining(txid: string, beef: string | undefined): { at?: number; needs?: number } {
  if (!beef) return {}
  try {
    const tx = Transaction.fromAtomicBEEF(fromBase64(beef))
    if (tx.id('hex') !== txid || !tx.merklePath) return {}
    return { at: tx.merklePath.blockHeight, needs: requiredHeaderHeight(txid, beef) }
  } catch {
    return {}
  }
}
export function readinessFacts(ticket: HandoffTicket, sender?: SenderRecord): ReadinessFacts {
  const t = mining(ticket.pkg.current.txid, ticket.pkg.atomicBeefBase64)
  const facts: ReadinessFacts = { ticketMinedAt: t.at, ticketNeeds: t.needs, fee: 'none' }
  if (!sender?.fundAttempt) return facts
  if (sender.fundAttempt.outcome !== 'complete' || !sender.funding?.txid || !sender.funding.beef) return { ...facts, fee: 'review' }
  const f = mining(sender.funding.txid, sender.funding.beef)
  return { ...facts, fee: 'created', feeMinedAt: f.at, feeNeeds: f.needs }
}

const block = (height: number) => height.toLocaleString('en-US')
const MINING_WAIT = 'usually one testnet block, about 10 minutes, sometimes longer'
export function offlineReadiness(facts: ReadinessFacts, env: ReadinessEnvironment): { ready: boolean; items: ReadinessItem[] } {
  const need = facts.ticketNeeds !== undefined && facts.feeNeeds !== undefined ? Math.max(facts.ticketNeeds, facts.feeNeeds) : undefined
  const items: ReadinessItem[] = [
    facts.ticketMinedAt !== undefined
      ? { key: 'ticket-mined', label: 'Ticket mined', state: 'done', detail: `Mined in block ${block(facts.ticketMinedAt)}.` }
      : {
          key: 'ticket-mined',
          label: 'Ticket mined',
          state: 'waiting',
          detail: `Waiting for mining: ${MINING_WAIT}. A newly issued or received ticket cannot be transferred offline until then.`,
        },
    facts.fee === 'created'
      ? { key: 'fee-created', label: 'Transfer fee output created', state: 'done', detail: 'Created. It pays the later transfer fee.' }
      : facts.fee === 'review'
        ? {
            key: 'fee-created',
            label: 'Transfer fee output created',
            state: 'todo',
            detail: 'The fee attempt needs review. Do not create another one.',
          }
        : {
            key: 'fee-created',
            label: 'Transfer fee output created',
            state: 'todo',
            detail: 'Select Review fee preparation below. This separate output pays the later transfer fee.',
          },
    facts.feeMinedAt !== undefined
      ? { key: 'fee-mined', label: 'Fee output mined', state: 'done', detail: `Mined in block ${block(facts.feeMinedAt)}.` }
      : facts.fee === 'created'
        ? {
            key: 'fee-mined',
            label: 'Fee output mined',
            state: 'waiting',
            detail: `Waiting for mining: ${MINING_WAIT}. Then select Check mining and prepare device.`,
          }
        : { key: 'fee-mined', label: 'Fee output mined', state: 'todo', detail: 'Once created, the fee output needs its own mining wait.' },
    need === undefined
      ? { key: 'headers', label: 'Block headers saved', state: 'waiting', detail: 'Needed once the ticket and fee output are mined.' }
      : env.snapshotTip !== undefined && env.snapshotTip >= need
        ? { key: 'headers', label: 'Block headers saved', state: 'done', detail: `Saved through block ${block(env.snapshotTip)}.` }
        : {
            key: 'headers',
            label: 'Block headers saved',
            state: 'todo',
            detail: `This device needs headers through block ${block(need)}. Check mining and prepare device saves them.`,
          },
    env.app === 'ready'
      ? { key: 'app', label: 'Offline app saved on this device', state: 'done', detail: 'TicketSV reopens here without internet.' }
      : env.app === 'unsupported'
        ? {
            key: 'app',
            label: 'Offline app saved on this device',
            state: 'note',
            detail:
              "This browser cannot reopen TicketSV without internet. Keep this page open and don't reload it until you're back online.",
          }
        : env.app === 'waiting'
          ? {
              key: 'app',
              label: 'Offline app saved on this device',
              state: 'waiting',
              detail: 'An update is saved. Select Reload in the update notice before going offline.',
            }
          : {
              key: 'app',
              label: 'Offline app saved on this device',
              state: 'todo',
              detail: 'Check mining and prepare device saves it. If this browser cannot, keep this page open instead.',
            },
    // Browsers decide whether to keep saved data, so this never blocks readiness.
    {
      key: 'storage',
      label: 'Saved data kept on this device',
      state: 'note',
      detail:
        env.storage === true
          ? 'Kept on this device.'
          : env.storage === false
            ? 'The browser may clear saved data after a period without visits. Open TicketSV now and then until the event.'
            : 'This browser does not say whether it keeps saved data.',
    },
    env.transport === 'browser-native'
      ? {
          key: 'wallet',
          label: 'Wallet',
          state: 'note',
          detail: 'BSV Browser signs inside the app without internet. Keep TicketSV open in BSV Browser.',
        }
      : {
          key: 'wallet',
          label: 'Wallet',
          state: 'note',
          detail: 'Keep BSV Desktop open on this computer. It signs without internet, and TicketSV reaches it on this computer only.',
        },
  ]
  return { ready: items.every(item => item.state === 'done' || item.state === 'note'), items }
}
