import { expect, it, vi } from 'vitest'
import { Transaction, Utils, type ListOutputsArgs, type WalletOutput } from '@bsv/sdk'
import { fundedForSigning, releaseSnapshot } from './helpers/sender-release-fixture.ts'
import { reviewFunding } from '../src/handoff/wallet.ts'

// Only the synthetic header boundary is replaced; signatures, BEEF and script verification remain real.
vi.mock('../src/headers/tracker.ts', async original => ({
  ...(await original<object>()),
  createLocalTracker: () => ({ isValidRootForHeight: async () => true, currentHeight: async () => 2000000 }),
}))
vi.mock('../src/settlement/evidence.ts', async original => ({ ...(await original<object>()), verifyMiningAnchor: () => true }))
const policy = { maxTxBytes: 100000, feeSatoshis: 1, feeBytes: 1000 }
const signal = () => new AbortController().signal

// BSV Browser returns basic output metadata without locking scripts.
async function sender() {
  const f = await fundedForSigning(),
    key = f.ticket.pkg.request.recipient
  const script = Transaction.fromAtomicBEEF(Utils.toArray(f.ticket.pkg.atomicBeefBase64, 'base64')).outputs[
    f.ticket.pkg.current.index
  ].lockingScript.toHex()
  const record: WalletOutput = {
    outpoint: `${f.ticket.pkg.current.txid}.${f.ticket.pkg.current.index}`,
    satoshis: 1,
    spendable: true,
    customInstructions: JSON.stringify({ type: 'PushDrop', protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty }),
  }
  return { ...f, record, script }
}
it('fee review accepts a wallet record without locking scripts', async () => {
  const f = await sender(),
    calls: ListOutputsArgs[] = []
  f.wallet.listOutputs = async args => {
    calls.push(args)
    return { totalOutputs: 1, outputs: [f.record] }
  }
  await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), releaseSnapshot)).resolves.toMatchObject({ ticket: f.ticket })
  expect(calls.every(args => args.include === undefined)).toBe(true)
})
it('fee review follows paged wallet listings', async () => {
  const f = await sender(),
    other = { ...f.record, outpoint: `${'cd'.repeat(32)}.0` }
  f.wallet.listOutputs = async args => ({ totalOutputs: 2, outputs: [args.offset === 0 ? other : f.record] })
  await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), releaseSnapshot)).resolves.toMatchObject({ ticket: f.ticket })
})
it('fee review still checks a returned script', async () => {
  const f = await sender()
  f.wallet.listOutputs = async () => ({ totalOutputs: 1, outputs: [{ ...f.record, lockingScript: f.script }] })
  await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), releaseSnapshot)).resolves.toMatchObject({ ticket: f.ticket })
})
it.each([
  ['a different script', { lockingScript: '51' }],
  ['a different amount', { satoshis: 2 }],
  ['an unspendable report', { spendable: false }],
  [
    'other key instructions',
    { customInstructions: JSON.stringify({ type: 'PushDrop', protocolID: [2, 'other'], keyID: 'x', counterparty: 'self' }) },
  ],
  ['no key instructions', { customInstructions: undefined }],
])('fee review refuses %s', async (_label, patch) => {
  const f = await sender()
  f.wallet.listOutputs = async () => ({ totalOutputs: 1, outputs: [{ ...f.record, ...patch }] })
  await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), releaseSnapshot)).rejects.toThrow(/wallet|record/i)
})
it('fee review refuses an absent ticket', async () => {
  const f = await sender()
  f.wallet.listOutputs = async () => ({ totalOutputs: 1, outputs: [{ ...f.record, outpoint: `${'cd'.repeat(32)}.0` }] })
  await expect(reviewFunding(f.ticket, policy, f.wallet, signal(), releaseSnapshot)).rejects.toThrow(/required in the wallet/i)
})
