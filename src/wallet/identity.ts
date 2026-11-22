import type { WalletInterface, WalletProtocol } from '@bsv/sdk'

type Reader = Pick<WalletInterface, 'getNetwork' | 'getPublicKey'>
export type WalletCall = <T>(method: 'getNetwork' | 'getPublicKey', work: () => Promise<T>) => Promise<T>
export type ReceivingKey = { protocolID: WalletProtocol; keyID: string; counterparty: string; publicKey: string }

// Every wallet flow confirms the same facts, in this order, before acting:
// testnet, the expected identity and, when receiving, the expected receiving
// key. Each flow keeps its own wording and its own call wrapper (cancellation,
// timeouts, logging). An expected identity given as a function is worked out
// only after the wallet reports its own, keeping each flow's original order. Returns
// the wallet's identity key.
export async function checkWallet(
  wallet: Reader,
  expected: {
    identity?: string | (() => string)
    receivingKey?: ReceivingKey
    messages: { network: string; identity?: string; receivingKey?: string }
    error?: (message: string) => Error
  },
  call: WalletCall = (_method, work) => work(),
): Promise<string> {
  const fail = (message: string): never => {
    throw (expected.error ?? Error)(message)
  }
  if ((await call('getNetwork', () => wallet.getNetwork({}))).network !== 'testnet') fail(expected.messages.network)
  const identity = (await call('getPublicKey', () => wallet.getPublicKey({ identityKey: true }))).publicKey
  const want = typeof expected.identity === 'function' ? expected.identity() : expected.identity
  if (want !== undefined && identity !== want) fail(expected.messages.identity ?? 'Wallet identity does not match.')
  const key = expected.receivingKey
  if (
    key &&
    (
      await call('getPublicKey', () =>
        wallet.getPublicKey({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, forSelf: true }),
      )
    ).publicKey !== key.publicKey
  )
    fail(expected.messages.receivingKey ?? 'Wallet receiving key does not match.')
  return identity
}
