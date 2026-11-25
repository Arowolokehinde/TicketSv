import { Transaction } from '@bsv/sdk'
import { boundedBytes } from '../http/bounded-bytes.ts'
import { WOC, pause, wocRequest } from '../http/woc.ts'
import { verifyTicketSpend } from '../verification/authenticity.ts'
import type { TicketPackage } from '../tickets/types.ts'

// A ticket is one output, and each resale spends it. A copy whose output is spent
// has been passed on, even if it was mined. WhatsOnChain reports spends; every
// reported spend is checked here against the ticket's lock before it is believed.
// An "unspent" answer has no second source and is trusted.
export { WOC }
export type SpentList = { id: string; revision: number; checkedAt: string; tickets: string[]; spent: string[] }
type Get = typeof fetch
const MAX_HOPS = 100,
  BATCH = 20,
  PACE_MS = 350
export const outpoint = (txid: string, index: number) => `${txid}.${index}`
const request = wocRequest
async function text(response: Response, limit: number, signal: AbortSignal) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw Error(`Spend check failed (HTTP ${response.status}).`)
  }
  return new TextDecoder().decode(await boundedBytes(response, limit, signal, false))
}
const txidPattern = /^[0-9a-f]{64}$/
// Fetches the reported spender and checks it really spends the ticket output.
async function spender(get: Get, tx: Transaction, index: number, by: unknown, signal: AbortSignal) {
  if (typeof by !== 'string' || !txidPattern.test(by)) throw Error('Spend check returned an invalid transaction ID.')
  const next = Transaction.fromHex((await text(await request(get, `${WOC}/tx/${by}/hex`, signal), 2_000_000, signal)).trim())
  if (next.id('hex') !== by) throw Error('Reported spending transaction does not match its ID.')
  return { tx: next, successor: verifyTicketSpend(tx, index, next) }
}

export async function checkSpent(
  tx: Transaction,
  index: number,
  signal: AbortSignal,
  get: Get = fetch,
): Promise<{ state: 'unspent' } | { state: 'spent'; by: string }> {
  const response = await request(get, `${WOC}/tx/${tx.id('hex')}/${index}/spent`, signal)
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {})
    return { state: 'unspent' }
  }
  const row = JSON.parse(await text(response, 16_384, signal)) as { txid?: unknown }
  const { tx: next } = await spender(get, tx, index, row?.txid, signal)
  return { state: 'spent', by: next.id('hex') }
}

// Follows every ticket of the event from its issuance through each validated
// transfer, and records which ticket outputs are already spent.
export async function walkTickets(
  eventId: string,
  packages: readonly TicketPackage[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void = () => {},
  get: Get = fetch,
): Promise<Omit<SpentList, 'id' | 'revision'>> {
  const tickets: string[] = [],
    spent: string[] = []
  let frontier: { tx: Transaction; index: number; hops: number }[] = []
  for (const pkg of packages) {
    if (pkg.issuance.eventId !== eventId) continue
    const issuance = Transaction.fromHex(pkg.lineageRawTxs[0])
    if (issuance.id('hex') !== pkg.issuance.origin.txid) throw Error('Issued ticket does not match its origin.')
    const key = outpoint(pkg.issuance.origin.txid, pkg.issuance.origin.index)
    if (tickets.includes(key)) continue
    tickets.push(key)
    frontier.push({ tx: issuance, index: pkg.issuance.origin.index, hops: 0 })
  }
  const total = tickets.length
  let first = true
  while (frontier.length) {
    const next: typeof frontier = []
    for (let i = 0; i < frontier.length; i += BATCH) {
      const batch = frontier.slice(i, i + BATCH)
      if (!first) await pause(PACE_MS, signal)
      first = false
      const body = JSON.stringify({ utxos: batch.map(item => ({ txid: item.tx.id('hex'), vout: item.index })) })
      const rows = JSON.parse(
        await text(
          await request(get, `${WOC}/utxos/spent`, signal, { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
          1_000_000,
          signal,
        ),
      ) as { utxo?: { txid?: string; vout?: number }; spentIn?: { txid?: unknown }; error?: string }[]
      if (!Array.isArray(rows) || rows.length !== batch.length) throw Error('Spend check returned an unexpected reply.')
      for (const [k, item] of batch.entries()) {
        const row = rows[k]
        if (row?.utxo?.txid !== item.tx.id('hex') || row.utxo.vout !== item.index || row.error)
          throw Error('Spend check returned an unexpected reply.')
        if (!row.spentIn) continue
        await pause(PACE_MS, signal)
        const found = await spender(get, item.tx, item.index, row.spentIn.txid, signal)
        spent.push(outpoint(item.tx.id('hex'), item.index))
        if (found.successor === undefined) continue
        if (item.hops + 1 > MAX_HOPS) throw Error('A ticket has more transfers than the door can check.')
        next.push({ tx: found.tx, index: found.successor, hops: item.hops + 1 })
      }
    }
    onProgress(total - next.length, total)
    frontier = next
  }
  return { checkedAt: new Date().toISOString(), tickets, spent }
}
