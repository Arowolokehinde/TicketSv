import { Beef, LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript } from '@bsv/sdk'
import type { CreateActionArgs, SignActionArgs, WalletInterface } from '@bsv/sdk'

// Synthetic fixtures only: deterministic test key and invented anchor, never live evidence.
// Matches Desktop 3.1.1's makeSignableTransactionBeef: raw immediate parents only.
export function signingDraftBytes(tx: Transaction): number[] {
  const beef = new Beef()
  for (const input of tx.inputs) {
    if (input.sourceTransaction) beef.mergeRawTx(input.sourceTransaction.toUint8Array())
  }
  beef.mergeRawTx(tx.toUint8Array())
  return beef.toBinaryAtomic(tx.id('hex'))
}

export function syntheticSigningWallet() {
  const crypto = new ProtoWallet(new PrivateKey(1))
  const funding = new Transaction(1, [], [{ satoshis: 10000, lockingScript: LockingScript.fromASM('OP_DROP OP_TRUE') }])
  funding.merklePath = new MerklePath(1, [[{ offset: 0, hash: funding.id('hex'), txid: true }]])
  let draft: Transaction
  const wallet = {
    getNetwork: async () => ({ network: 'testnet' }),
    getPublicKey: crypto.getPublicKey.bind(crypto),
    createSignature: crypto.createSignature.bind(crypto),
    createAction: async (args: CreateActionArgs) => {
      const outputs = args.outputs!.map(o => ({ satoshis: o.satoshis, lockingScript: LockingScript.fromHex(o.lockingScript) }))
      if (!args.inputs?.length) {
        const tx = new Transaction(1, [{ sourceTransaction: funding, sourceOutputIndex: 0, unlockingScript: UnlockingScript.fromASM('OP_1') }], [...outputs, { satoshis: 9998, lockingScript: LockingScript.fromASM('OP_DROP OP_TRUE') }])
        return { tx: tx.toAtomicBEEF(), txid: tx.id('hex'), noSendChange: [`${tx.id('hex')}.1`] }
      }
      const parent = Transaction.fromAtomicBEEF(args.inputBEEF!)
      draft = new Transaction(1, [
        { sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() },
        { sourceTransaction: parent, sourceOutputIndex: 1, unlockingScript: UnlockingScript.fromASM('OP_1') },
      ], [...outputs, { satoshis: 9997, lockingScript: LockingScript.fromASM('OP_DROP OP_TRUE') }])
      return { signableTransaction: { tx: signingDraftBytes(draft), reference: 'dGVzdA==' } }
    },
    signAction: async (args: SignActionArgs) => {
      for (const [index, spend] of Object.entries(args.spends)) draft.inputs[Number(index)]!.unlockingScript = UnlockingScript.fromHex(spend.unlockingScript)
      return { tx: draft.toAtomicBEEF(), txid: draft.id('hex') }
    },
  } as unknown as WalletInterface
  return wallet
}

