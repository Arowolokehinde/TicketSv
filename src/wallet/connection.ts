import type { WalletInterface } from '@bsv/sdk'
import { BSV_NETWORK } from '../config/network.ts'
import { readFailureResponse, type WalletFailureResponse } from './diagnostics.ts'

export type WalletTransport = 'desktop-http' | 'desktop-https' | 'browser-native'
export type ProbeClient = Pick<WalletInterface, 'getNetwork' | 'getVersion' | 'getPublicKey'>
export type ProbeCall = { method: keyof ProbeClient; status: 'started' | 'returned' | 'failed' }
export type ConnectionEvidence = { network: 'testnet'; identityKey: string; version: string; checkedAt: string }
export const CONNECTION_TIMEOUT_MS = 30_000

const messages = {
  'wrong-network': 'The wallet is not on testnet. Switch its selected network to testnet, then retry.',
  'invalid-response': 'The wallet returned an invalid response. Check the wallet version and selected connection method.',
  'missing-bridge': 'The native wallet bridge is unavailable. Open this app inside BSV Browser, or select a desktop connection.',
  'request-failed': 'The wallet request failed or was declined. Check that BSV Desktop is running, review its permission prompt, and confirm the selected connection method. Browser connection restrictions can also block access.',
  'cancelled': 'Connection cancelled. Any remaining native wallet prompt must be dismissed in the wallet.',
  'timeout': 'The wallet did not complete the check within 30 seconds. Check its permission prompt and connection method, then retry.',
} as const
export class ConnectionError extends Error {
  readonly code: keyof typeof messages
  constructor(code: keyof typeof messages) { super(messages[code]); this.code = code }
}
function abortReason(signal: AbortSignal): ConnectionError {
  return signal.reason instanceof ConnectionError ? signal.reason : new ConnectionError('cancelled')
}
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

// Cancellation stops this experiment, including later calls, even if a native
// bridge cannot dismiss the original wallet prompt. No late result is accepted.
async function invoke<T>(method: keyof ProbeClient, operation: () => Promise<T>, signal: AbortSignal, log: (entry: ProbeCall) => void): Promise<T> {
  checkAbort(signal)
  log({ method, status: 'started' })
  try {
    const result = await new Promise<T>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(abortReason(signal)) }
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => { checkAbort(signal); return operation() }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    checkAbort(signal)
    log({ method, status: 'returned' })
    return result
  } catch (error) {
    log({ method, status: 'failed' })
    if (signal.aborted) throw abortReason(signal)
    throw error instanceof ConnectionError ? error : new ConnectionError('request-failed')
  }
}
export async function probeWallet(client: ProbeClient, signal: AbortSignal, log: (entry: ProbeCall) => void = () => {}): Promise<ConnectionEvidence> {
  const network = await invoke('getNetwork', () => client.getNetwork({}), signal, log)
  if (network?.network !== BSV_NETWORK) throw new ConnectionError('wrong-network')
  const version = await invoke('getVersion', () => client.getVersion({}), signal, log)
  if (typeof version?.version !== 'string' || version.version.length < 7 || version.version.length > 30) throw new ConnectionError('invalid-response')
  const key = await invoke('getPublicKey', () => client.getPublicKey({ identityKey: true }), signal, log)
  try {
    const { PublicKey } = await import('@bsv/sdk/primitives')
    if (typeof key?.publicKey !== 'string' || !/^(02|03)[0-9a-fA-F]{64}$/.test(key.publicKey)) throw new Error('invalid')
    const parsed = PublicKey.fromString(key.publicKey)
    if (!parsed.validate() || parsed.toString().toLowerCase() !== key.publicKey.toLowerCase()) throw new Error('invalid')
  } catch { throw new ConnectionError('invalid-response') }
  checkAbort(signal)
  const finalNetwork = await invoke('getNetwork', () => client.getNetwork({}), signal, log)
  if (finalNetwork?.network !== BSV_NETWORK) throw new ConnectionError('wrong-network')
  return { network: BSV_NETWORK, identityKey: key.publicKey, version: version.version, checkedAt: new Date().toISOString() }
}

// Race the entire attempt, including lazy imports. Imports cannot be cancelled,
// so the checks in connectSelectedWallet also prevent calls after they arrive.
export function connectWallet(transport: WalletTransport, signal: AbortSignal, log: (entry: ProbeCall) => void): Promise<ConnectionEvidence> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortReason(signal)) }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    connectSelectedWallet(transport, signal, log).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

async function connectSelectedWallet(transport: WalletTransport, signal: AbortSignal, log: (entry: ProbeCall) => void): Promise<ConnectionEvidence> {
  return probeWallet(await openWalletClient(transport, signal), signal, log)
}

export async function openWalletClient(transport: WalletTransport, signal: AbortSignal, onFailureResponse?: (failure: WalletFailureResponse) => void): Promise<WalletInterface> {
  checkAbort(signal)
  try {
    const { WalletClient } = await import('@bsv/sdk/wallet')
    checkAbort(signal)
    const originator = window.location.hostname
    let substrate: WalletInterface
    if (transport === 'browser-native') {
      const { default: ReactNativeWebView } = await import('@bsv/sdk/wallet/substrates/ReactNativeWebView')
      checkAbort(signal)
      try { substrate = new ReactNativeWebView('*', CONNECTION_TIMEOUT_MS) }
      catch { throw new ConnectionError('missing-bridge') }
    } else {
      const { default: HTTPWalletJSON } = await import('@bsv/sdk/wallet/substrates/HTTPWalletJSON')
      checkAbort(signal)
      const endpoint = transport === 'desktop-http' ? 'http://localhost:3321' : 'https://localhost:2121'
      const abortableFetch: typeof fetch = async (input, init) => {
        const response = await fetch(input, { ...init, signal, redirect: 'error' })
        if (!response.ok && onFailureResponse && !signal.aborted) {
          const method = new URL(input instanceof Request ? input.url : String(input)).pathname.slice(1)
          const failure = await readFailureResponse(response, method)
          if (!signal.aborted) onFailureResponse(failure)
        }
        return response
      }
      substrate = new HTTPWalletJSON(originator, endpoint, abortableFetch)
    }
    return new WalletClient(substrate, originator)
  } catch (error) {
    if (signal.aborted) throw abortReason(signal)
    throw error instanceof ConnectionError ? error : new ConnectionError('request-failed')
  }
}
