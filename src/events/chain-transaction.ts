import { Beef, Transaction } from '@bsv/sdk'
import { boundedBytes } from '../http/bounded-bytes.ts'
import { WOC, pause, wocRequest } from '../http/woc.ts'

// Rebuilds an issued ticket transaction, as unmined Atomic BEEF, from the public
// chain. Nothing from the network is trusted: the bytes must hash to the saved
// ID, and each parent must be the one the transaction spends. Mining proofs are
// still checked later against each device's own headers.
export const NOT_VISIBLE = "This transaction isn't visible on the network yet. Try again in a minute."
const DIFFERENT = 'The network returned a different transaction. Nothing was saved.'
const NO_PARENT = "A transaction this ticket depends on isn't available yet. Try again after the next block."
const PACE_MS = 350

async function text(response: Response, limit: number, signal: AbortSignal, missing: string): Promise<string> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw Error(response.status === 404 ? missing : `WhatsOnChain request failed (HTTP ${response.status}).`)
  }
  return new TextDecoder().decode(await boundedBytes(response, limit, signal, false)).trim()
}
export async function fetchIssuedTransaction(txid: string, signal: AbortSignal, get: typeof fetch = fetch): Promise<number[]> {
  const raw = await text(await wocRequest(get, `${WOC}/tx/${txid}/hex`, signal), 2_000_000, signal, NOT_VISIBLE)
  let tx: Transaction
  try {
    tx = Transaction.fromHex(raw)
  } catch {
    throw Error(DIFFERENT)
  }
  if (tx.id('hex') !== txid) throw Error(DIFFERENT)
  const beef = new Beef()
  const parents = [...new Set(tx.inputs.map(input => input.sourceTXID!))]
  for (const [index, parent] of parents.entries()) {
    if (index) await pause(PACE_MS, signal)
    const source = await text(await wocRequest(get, `${WOC}/tx/${parent}/beef`, signal), 4_000_000, signal, NO_PARENT)
    let found = false
    try {
      const parentBeef = Beef.fromString(source, 'hex')
      found = Boolean(parentBeef.findTxid(parent))
      if (found) beef.mergeBeef(parentBeef)
    } catch {
      found = false
    }
    if (!found) throw Error(NO_PARENT)
  }
  beef.mergeRawTx(tx.toBinary())
  return beef.toBinaryAtomic(txid)
}
