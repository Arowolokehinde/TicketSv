import { describe, expect, it, vi } from 'vitest'
import { Beef, LockingScript, PrivateKey, ProtoWallet, Transaction } from '@bsv/sdk'
import { signingDraftBytes, syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { inspectFinal, prepareSigning, restorePreparation, transferSigning } from '../src/wallet/signing-experiment.ts'

function setup() {
  const wallet = syntheticSigningWallet()
  for (const name of ['getNetwork', 'getPublicKey', 'createSignature', 'createAction', 'signAction'] as const) {
    Object.assign(wallet, { [name]: vi.fn(wallet[name]) })
  }
  return { wallet }
}

describe('noSend signing experiment', () => {
  it('restores saved preparation without creating a transaction or signature', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    Object.assign(wallet, { listOutputs: vi.fn(async () => ({ totalOutputs: 1, outputs: [{ outpoint: `${source.source.txid}.${source.source.outputIndex}`, spendable: true }] })) })
    vi.mocked(wallet.createSignature).mockClear()
    vi.mocked(wallet.createAction).mockClear()
    expect(await restorePreparation(wallet, JSON.stringify(source))).toEqual(source)
    expect(wallet.createAction).not.toHaveBeenCalled()
    expect(wallet.createSignature).not.toHaveBeenCalled()
  })

  it('rejects a saved preparation that redirects the successor to a different wallet key', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    const other = await prepareSigning(syntheticSigningWallet(), 'different-run')
    source.destinationScript = other.destinationScript
    vi.mocked(wallet.createAction).mockClear()
    await expect(restorePreparation(wallet, JSON.stringify(source))).rejects.toThrow('script')
    expect(wallet.createAction).not.toHaveBeenCalled()
  })

  it('blocks restoration when the prepared output is not available', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    Object.assign(wallet, { listOutputs: vi.fn(async () => ({ totalOutputs: 0, outputs: [] })) })
    await expect(restorePreparation(wallet, JSON.stringify(source))).rejects.toThrow('not listed as spendable')
  })

  it('rejects malformed preparation before contacting a wallet', async () => {
    const { wallet } = setup()
    await expect(restorePreparation(wallet, '{"kind":"ticket-package"}')).rejects.toThrow('preparation')
    expect(wallet.getNetwork).not.toHaveBeenCalled()
  })
  it('accepts a Desktop signing-only draft but requires complete final evidence, with noSend and no fetch', async () => {
    const { wallet } = setup()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    try {
      const source = await prepareSigning(wallet, 'test-run')
      const reference = vi.fn()
      const result = await transferSigning(wallet, source, reference)
      const draft = (await vi.mocked(wallet.createAction).mock.results[1]!.value).signableTransaction!
      expect(Beef.fromBinary(draft.tx).isValid(false)).toBe(false)
      expect(Beef.fromBinary(result.atomicBeef).isValid(false)).toBe(true)
      expect(reference).toHaveBeenCalledWith('dGVzdA==')
      expect(result.txid).not.toBe(source.source.txid)
      expect(result.atomicBeef.length).toBeGreaterThan(0)
      for (const [args] of vi.mocked(wallet.createAction).mock.calls) {
        expect(args.options).toMatchObject({ noSend: true, returnTXIDOnly: false, randomizeOutputs: false })
        expect(args.options?.sendWith).toBeUndefined()
      }
      expect(wallet.signAction).toHaveBeenCalledWith(expect.objectContaining({ options: { noSend: true, returnTXIDOnly: false } }))
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  it('rejects mainnet before key or transaction requests', async () => {
    const { wallet } = setup()
    vi.mocked(wallet.getNetwork).mockResolvedValue({ network: 'mainnet' })
    await expect(prepareSigning(wallet, 'test-run')).rejects.toThrow('testnet')
    expect(wallet.getPublicKey).not.toHaveBeenCalled()
    expect(wallet.createAction).not.toHaveBeenCalled()
  })

  it('rejects an identity switch before spending the prepared fixture', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    const other = new ProtoWallet(new PrivateKey(2))
    vi.mocked(wallet.getPublicKey).mockImplementation(other.getPublicKey.bind(other))
    await expect(transferSigning(wallet, source)).rejects.toThrow('identity')
    expect(wallet.createAction).toHaveBeenCalledTimes(1)
  })

  it('does not sign a changed successor output and preserves the pending reference', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    const create = vi.mocked(wallet.createAction).getMockImplementation()!
    vi.mocked(wallet.createAction).mockImplementationOnce(async args => {
      const response = await create(args)
      const tx = Transaction.fromAtomicBEEF(response.signableTransaction!.tx)
      tx.outputs[0]!.lockingScript = LockingScript.fromASM('OP_TRUE')
      return { signableTransaction: { reference: 'dGVzdA==', tx: signingDraftBytes(tx) } }
    })
    const reference = vi.fn()
    await expect(transferSigning(wallet, source, reference)).rejects.toThrow('output')
    expect(reference).toHaveBeenCalledWith('dGVzdA==')
    expect(wallet.signAction).not.toHaveBeenCalled()
  })

  it('rejects signable responses as final evidence', async () => {
    await expect(inspectFinal({ signableTransaction: { reference: 'dGVzdA==', tx: [] } }, '51')).rejects.toThrow('final')
  })

  it.each(['missing-parent', 'missing-output'] as const)('rejects a signing draft with %s before requesting a signature', async defect => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    const create = vi.mocked(wallet.createAction).getMockImplementation()!
    vi.mocked(wallet.createSignature).mockClear()
    vi.mocked(wallet.createAction).mockImplementationOnce(async args => {
      const response = await create(args)
      const draft = Transaction.fromAtomicBEEF(response.signableTransaction!.tx)
      if (defect === 'missing-output') draft.inputs[0]!.sourceOutputIndex = 999
      const beef = Beef.fromBinary(signingDraftBytes(draft))
      if (defect === 'missing-parent') beef.removeExistingTxid(source.source.txid)
      return { signableTransaction: { reference: 'dGVzdA==', tx: beef.toBinaryAtomic(draft.id('hex')) } }
    })
    await expect(transferSigning(wallet, source)).rejects.toThrow('source output')
    expect(wallet.createSignature).not.toHaveBeenCalled()
    expect(wallet.signAction).not.toHaveBeenCalled()
  })

  it('still rejects a signed result that omits full dependencies', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    const sign = vi.mocked(wallet.signAction).getMockImplementation()!
    vi.mocked(wallet.signAction).mockImplementationOnce(async args => {
      const response = await sign(args)
      return { txid: response.txid, tx: signingDraftBytes(Transaction.fromAtomicBEEF(response.tx!)) }
    })
    await expect(transferSigning(wallet, source)).rejects.toThrow('Incomplete Atomic BEEF')
    expect(wallet.signAction).toHaveBeenCalledTimes(1)
  })

  it('rejects incomplete BEEF and a wrong reported txid', async () => {
    const { wallet } = setup()
    const source = await prepareSigning(wallet, 'test-run')
    await expect(inspectFinal({ tx: source.source.atomicBeef, txid: '00'.repeat(32) }, source.sourceScript)).rejects.toThrow('txid')
    const beef = Beef.fromBinary(source.source.atomicBeef)
    beef.version = 0xefbe0002 // BEEF V2 supports explicit txid-only entries.
    beef.makeTxidOnly(beef.txs[0]!.txid)
    await expect(inspectFinal({ tx: beef.toBinaryAtomic(source.source.txid), txid: source.source.txid }, source.sourceScript)).rejects.toThrow()
  })
})
