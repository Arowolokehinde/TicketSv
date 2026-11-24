import type { ListOutputsArgs, ListOutputsResult, WalletOutput } from '@bsv/sdk'
import type { KeyBinding } from '../tickets/types.ts'

export type ExpectedTicketRecord = {
  outpoint: string
  satoshis: number
  lockingScript: string
  key: Pick<KeyBinding, 'protocolID' | 'keyID' | 'counterparty'>
}
export type TicketWalletRecord = { state: 'present' | 'absent' | 'inconclusive'; reason: string }

// Callers first verify the mined ticket and the connected identity/receiving key.
// This observes wallet registration only. The exact txid and output index bind
// the returned record to that verified transaction; exporting its BEEF again is
// unnecessary and does not prove current unspentness or signing readiness.
export async function inspectTicketWalletRecord(
  read: (args: ListOutputsArgs) => Promise<ListOutputsResult>,
  expected: ExpectedTicketRecord,
): Promise<TicketWalletRecord> {
  const unclear = (): TicketWalletRecord => ({
    state: 'inconclusive',
    reason: 'Wallet records are incomplete or differ from this ticket. Recheck the wallet record before considering import.',
  })
  const outputs = await listBasket(read, 'ticketsv-tickets')
  if (!outputs) return unclear()
  const match = outputs.find(output => output.outpoint === expected.outpoint)
  if (!match) return { state: 'absent', reason: 'The exact ticket output is absent from this complete TicketSV basket listing.' }
  if (
    match.spendable !== true ||
    match.satoshis !== expected.satoshis ||
    (match.lockingScript !== undefined && match.lockingScript.toLowerCase() !== expected.lockingScript.toLowerCase()) ||
    typeof match.customInstructions !== 'string'
  )
    return unclear()
  try {
    const instructions = JSON.parse(match.customInstructions),
      key = expected.key
    if (
      !instructions ||
      instructions.type !== 'PushDrop' ||
      instructions.keyID !== key.keyID ||
      instructions.counterparty !== key.counterparty ||
      JSON.stringify(instructions.protocolID) !== JSON.stringify(key.protocolID)
    )
      return unclear()
  } catch {
    return unclear()
  }
  return {
    state: 'present',
    reason:
      'Matching ticket output and receiving-key instructions are recorded in your wallet. This does not establish current chain unspentness or signing readiness.',
  }
}

// Reads one complete basket within the 1000-output review bound. Capped pages
// are followed; malformed, duplicate, changing or incomplete listings return
// undefined because they cannot establish presence or absence.
export async function listBasket(
  read: (args: ListOutputsArgs) => Promise<ListOutputsResult>,
  basket: string,
): Promise<WalletOutput[] | undefined> {
  const seen = new Set<string>(),
    outputs: WalletOutput[] = []
  let total: number | undefined
  do {
    const listing = await read({ basket, includeCustomInstructions: true, limit: 1000, offset: seen.size })
    if (
      !listing ||
      !Number.isSafeInteger(listing.totalOutputs) ||
      listing.totalOutputs < 0 ||
      listing.totalOutputs > 1000 ||
      (total !== undefined && listing.totalOutputs !== total) ||
      !Array.isArray(listing.outputs) ||
      listing.outputs.length > listing.totalOutputs - seen.size
    )
      return
    total = listing.totalOutputs
    if (!listing.outputs.length && seen.size < total) return
    for (const output of listing.outputs) {
      if (
        !output ||
        typeof output.outpoint !== 'string' ||
        !/^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/.test(output.outpoint) ||
        Number(output.outpoint.split('.')[1]) > 0xffffffff ||
        seen.has(output.outpoint) ||
        !Number.isSafeInteger(output.satoshis) ||
        output.satoshis < 0 ||
        typeof output.spendable !== 'boolean'
      )
        return
      if (
        output.lockingScript !== undefined &&
        (typeof output.lockingScript !== 'string' ||
          output.lockingScript.length > 8 * 1024 * 1024 ||
          !/^(?:[a-fA-F0-9]{2})*$/.test(output.lockingScript))
      )
        return
      if (
        output.customInstructions !== undefined &&
        (typeof output.customInstructions !== 'string' || output.customInstructions.length > 10000)
      )
        return
      seen.add(output.outpoint)
      outputs.push(output)
    }
  } while (seen.size < total)
  return outputs
}
