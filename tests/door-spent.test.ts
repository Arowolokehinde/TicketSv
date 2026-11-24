import { describe, expect, it } from 'vitest'
import { Transaction, UnlockingScript } from '@bsv/sdk'
import { conflictFixture } from './helpers/conflict-fixture.ts'
import { realTicket } from './helpers/real-ticket.ts'
import { checkSpent, walkTickets, WOC } from '../src/scanner/spent.ts'
import { verifyContinuity, verifyTicketSpend } from '../src/verification/authenticity.ts'

const signal = () => new AbortController().signal
// Answers like WhatsOnChain testnet: spender rows for spent outputs, 404 otherwise.
function provider(spends: Record<string, Transaction>, hex: Record<string, string> = {}) {
  const calls: string[] = []
  const get = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const single = /\/tx\/([0-9a-f]{64})\/(\d+)\/spent$/.exec(url)
    if (single) {
      const by = spends[`${single[1]}.${single[2]}`]
      return by ? Response.json({ txid: by.id('hex'), vin: 0, status: 'unconfirmed' }) : new Response('Not Found', { status: 404 })
    }
    if (url === `${WOC}/utxos/spent`) {
      const { utxos } = JSON.parse(String(init?.body)) as { utxos: { txid: string; vout: number }[] }
      return Response.json(
        utxos.map(utxo => {
          const by = spends[`${utxo.txid}.${utxo.vout}`]
          return by ? { utxo, spentIn: { txid: by.id('hex'), vin: 0, status: 'confirmed' }, error: '' } : { utxo, error: '' }
        }),
      )
    }
    const tx = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url)
    if (tx) {
      const found =
        hex[tx[1]] ??
        Object.values(spends)
          .find(t => t.id('hex') === tx[1])
          ?.toHex()
      return found ? new Response(found) : new Response('Not Found', { status: 404 })
    }
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
  return { get, calls }
}
async function fixture() {
  const f = await conflictFixture(),
    a = Transaction.fromHex(f.pair.a.pkg.lineageRawTxs.at(-1)!)
  return { f, a, origin: `${f.issuance.id('hex')}.0` }
}

describe('ticket spend validation', () => {
  it('returns the successor output of a valid ticket spend', async () => {
    const { f, a } = await fixture()
    expect(verifyTicketSpend(f.issuance, 0, a)).toBe(0)
    expect(() => verifyContinuity(f.pair.a.pkg)).not.toThrow()
  })
  it('rejects a transaction that does not spend the output, or spends it with a bad signature', async () => {
    const { f, a } = await fixture()
    const b = Transaction.fromHex(f.pair.b.pkg.lineageRawTxs.at(-1)!)
    expect(() => verifyTicketSpend(a, 0, b)).toThrow(/not spent exactly once/)
    expect(() => verifyTicketSpend(f.issuance, 1, a)).toThrow('Not a ticket output')
    const forged = Transaction.fromHex(a.toHex())
    forged.inputs[0].unlockingScript = new UnlockingScript()
    expect(() => verifyTicketSpend(f.issuance, 0, forged)).toThrow(/signature\/script is invalid/)
  })
})

describe('real testnet transfer', () => {
  it("validates the real transfer as the spend of the seller's earlier output", () => {
    const raws = realTicket('mined').pkg.lineageRawTxs,
      previous = Transaction.fromHex(raws.at(-2)!),
      current = Transaction.fromHex(raws.at(-1)!),
      index = current.inputs.find(i => i.sourceTXID === previous.id('hex'))!.sourceOutputIndex
    expect(verifyTicketSpend(previous, index, current)).toBe(realTicket('mined').pkg.current.index)
  })
})

describe('live spend check', () => {
  it('reports a validated spender', async () => {
    const { f, a } = await fixture()
    expect(await checkSpent(f.issuance, 0, signal(), provider({ [`${f.issuance.id('hex')}.0`]: a }).get)).toEqual({
      state: 'spent',
      by: a.id('hex'),
    })
  })
  it('reports an output the provider does not know as spent as unspent', async () => {
    const { a } = await fixture()
    expect(await checkSpent(a, 0, signal(), provider({}).get)).toEqual({ state: 'unspent' })
  })
  it('never trusts a reported spender that does not validate', async () => {
    const { f, a } = await fixture(),
      forged = Transaction.fromHex(a.toHex())
    forged.inputs[0].unlockingScript = new UnlockingScript()
    await expect(checkSpent(f.issuance, 0, signal(), provider({ [`${f.issuance.id('hex')}.0`]: forged }).get)).rejects.toThrow(
      'Retained ticket input signature/script is invalid',
    )
    const other = Transaction.fromHex(f.pair.b.pkg.lineageRawTxs.at(-1)!)
    const lying = provider({ [`${f.issuance.id('hex')}.0`]: a }, { [a.id('hex')]: other.toHex() })
    await expect(checkSpent(f.issuance, 0, signal(), lying.get)).rejects.toThrow(/does not match/)
  })
})

describe('rate limits', () => {
  it('retries when a rate-limited reply reaches the browser as a network error', async () => {
    const { f, a, origin } = await fixture(),
      inner = provider({ [origin]: a }).get
    let failures = 1
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (failures-- > 0) throw new TypeError('Failed to fetch')
      return inner(input, init)
    }) as typeof fetch
    expect((await checkSpent(f.issuance, 0, signal(), flaky)).state).toBe('spent')
  }, 10_000)
})

describe('saved spent list', () => {
  it('follows each ticket through its validated transfers and records the spent outputs', async () => {
    const { f, a, origin } = await fixture()
    const progress: number[] = []
    const list = await walkTickets('conflict-event', [f.base], signal(), done => progress.push(done), provider({ [origin]: a }).get)
    expect(list.tickets).toEqual([origin])
    expect(list.spent).toEqual([origin])
    expect(Number.isFinite(Date.parse(list.checkedAt))).toBe(true)
    expect(progress.at(-1)).toBe(1)
  })
  it('records nothing spent for a ticket still at its issuance', async () => {
    const { f, origin } = await fixture()
    expect(await walkTickets('conflict-event', [f.base], signal(), undefined, provider({}).get)).toMatchObject({
      tickets: [origin],
      spent: [],
    })
  })
  it('skips tickets of another event', async () => {
    const { f } = await fixture()
    expect((await walkTickets('other-event', [f.base], signal(), undefined, provider({}).get)).tickets).toEqual([])
  })
})
