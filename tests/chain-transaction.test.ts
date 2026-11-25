import { describe, expect, it } from 'vitest'
import { Transaction, Utils } from '@bsv/sdk'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { issueVenueTicket, prepareVenueRecipient } from '../src/wallet/venue-issuance.ts'
import { fetchIssuedTransaction } from '../src/events/chain-transaction.ts'
import { WOC } from '../src/http/woc.ts'
import { fromBase64 } from '../src/tickets/codec.ts'

async function issued() {
  const wallet = syntheticSigningWallet()
  const owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
  const request = await prepareVenueRecipient(wallet, owner, 'ticket-test')
  const pkg = await issueVenueTicket(wallet, owner, 'event-test', 'ticket-test', request, async () => {})
  return Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64))
}
// Serves a transaction's raw hex and its parents' BEEF, as WhatsOnChain does.
function chain(tx: Transaction, overrides: Record<string, Response> = {}) {
  const parents = new Map(tx.inputs.map(input => [input.sourceTXID ?? input.sourceTransaction!.id('hex'), input.sourceTransaction!]))
  const requests: string[] = []
  const get = (async (url: string) => {
    const path = String(url).slice(WOC.length)
    requests.push(path)
    if (overrides[path]) return overrides[path]
    if (path === `/tx/${tx.id('hex')}/hex`) return new Response(tx.toHex())
    const parent = parents.get(path.split('/')[2])
    if (parent && path.endsWith('/beef')) return new Response(Utils.toHex(parent.toBEEF()))
    return new Response('Not found', { status: 404 })
  }) as typeof fetch
  return { get, requests }
}
const signal = () => new AbortController().signal

describe('fetchIssuedTransaction', () => {
  it('rebuilds the unmined Atomic BEEF from the transaction and its parents', async () => {
    const tx = await issued()
    const beef = await fetchIssuedTransaction(tx.id('hex'), signal(), chain(tx).get)
    const rebuilt = Transaction.fromAtomicBEEF(beef)
    expect(rebuilt.id('hex')).toBe(tx.id('hex'))
    expect(rebuilt.merklePath).toBeUndefined()
    expect(await rebuilt.verify('scripts only')).toBe(true)
  })
  it('fetches a shared parent once', async () => {
    const tx = await issued(),
      parent = tx.inputs[0].sourceTransaction!
    const twice = new Transaction()
    twice.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript })
    twice.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: tx.inputs[0].unlockingScript })
    twice.addOutput({ lockingScript: tx.outputs[0].lockingScript, satoshis: 1 })
    const { get, requests } = chain(twice)
    await fetchIssuedTransaction(twice.id('hex'), signal(), get)
    expect(requests.filter(path => path === `/tx/${parent.id('hex')}/beef`)).toHaveLength(1)
  })
  it('says when the transaction is not visible yet', async () => {
    const tx = await issued()
    const { get } = chain(tx, { [`/tx/${tx.id('hex')}/hex`]: new Response('Not found', { status: 404 }) })
    await expect(fetchIssuedTransaction(tx.id('hex'), signal(), get)).rejects.toThrow(
      "This transaction isn't visible on the network yet. Try again in a minute.",
    )
  })
  it('refuses bytes that do not match the saved ID', async () => {
    const tx = await issued(),
      other = tx.inputs[0].sourceTransaction!
    for (const body of [other.toHex(), '<html>Bad gateway</html>']) {
      const { get } = chain(tx, { [`/tx/${tx.id('hex')}/hex`]: new Response(body) })
      await expect(fetchIssuedTransaction(tx.id('hex'), signal(), get)).rejects.toThrow(
        'The network returned a different transaction. Nothing was saved.',
      )
    }
  })
  it('says when a parent is not available', async () => {
    const tx = await issued(),
      parent = tx.inputs[0].sourceTransaction!.id('hex'),
      lone = new Transaction()
    lone.addOutput({ lockingScript: tx.outputs[0].lockingScript, satoshis: 1 })
    const unrelated = Utils.toHex(lone.toBEEF())
    for (const response of [new Response('Not found', { status: 404 }), new Response(unrelated)]) {
      const { get } = chain(tx, { [`/tx/${parent}/beef`]: response })
      await expect(fetchIssuedTransaction(tx.id('hex'), signal(), get)).rejects.toThrow(
        "A transaction this ticket depends on isn't available yet. Try again after the next block.",
      )
    }
  })
})
