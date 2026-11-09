import type { WalletInterface } from '@bsv/sdk'
import { openWalletClient, probeWallet, type WalletTransport } from '../wallet/connection.ts'
import { api, type AuthSession } from './api.ts'

// AuthFetch supports paid requests too. This narrow capability wrapper makes
// every transaction/record-changing wallet method unavailable during login.
export function authenticationWallet(wallet: WalletInterface, signal: AbortSignal): WalletInterface {
  const allowed = new Set(['getPublicKey', 'createSignature', 'verifySignature', 'createHmac', 'verifyHmac'])
  return new Proxy(wallet, { get(target, property) {
    return async (...args: unknown[]) => {
      signal.throwIfAborted()
      if (!allowed.has(String(property))) throw new Error('Authentication cannot create payments or change wallet records.')
      const method = target[property as keyof WalletInterface] as Function
      const result = await method.apply(target, args)
      signal.throwIfAborted()
      return result
    }
  } })
}
export async function signIn(transport: WalletTransport, signal: AbortSignal): Promise<AuthSession> {
  let cancellationToken: string | undefined
  try {
  const wallet = await openWalletClient(transport, signal)
  const before = await probeWallet(wallet, signal)
  const challenge = await api<{ nonce: string; cancellationToken: string; origin: string; purpose: string; network: string }>('/api/auth/challenge', { method: 'POST', body: '{}', signal })
  cancellationToken = challenge.cancellationToken
  if (!/^[0-9a-f]{64}$/.test(cancellationToken ?? '') || challenge.origin !== location.origin || challenge.network !== 'testnet' || challenge.purpose !== 'Sign in to TicketSV' || !/^[0-9a-f]{64}$/.test(challenge.nonce)) throw new Error('The server returned an invalid sign-in request.')
  const { AuthFetch } = await import('@bsv/sdk/auth')
  const auth = new AuthFetch(authenticationWallet(wallet, signal), undefined, undefined, location.hostname, { maxResponseBytes: 16_384 }, async (input, init) => {
    signal.throwIfAborted()
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== location.origin || !['/.well-known/auth', '/api/auth/login'].includes(url.pathname)) throw new Error('Unexpected authentication destination.')
    // Recheck the selected wallet before sending the signed login request.
    if (url.pathname === '/api/auth/login' && new Headers(init?.headers).has('x-bsv-auth-signature')) {
      const after = await probeWallet(wallet, signal)
      if (before.identityKey !== after.identityKey) throw new Error('The wallet account changed. Please reconnect.')
    }
    const response = await fetch(input, { ...init, credentials: 'same-origin', redirect: 'error', signal })
    if (response.status === 402) throw new Error('Signing in must not request a payment.')
    return response
  })
  const response = await auth.fetch(location.origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(challenge) })
  signal.throwIfAborted()
  const result = await response.json() as AuthSession & { error?: string }
  signal.throwIfAborted()
  if (!response.ok) throw new Error(result.error ?? 'Your sign-in could not be verified.')
  if (result.identityKey !== before.identityKey || result.network !== 'testnet') {
    throw new Error('The signed identity did not match the connected wallet.')
  }
  return result
  } catch (failure) {
    if (cancellationToken) {
      try { await api('/api/auth/cancel', { method: 'POST', body: JSON.stringify({ cancellationToken }) }) }
      catch { throw new Error('Sign-in outcome could not be confirmed. Reconnect to TicketSV and check your account before retrying.') }
    }
    if (signal.aborted) throw signal.reason
    throw failure
  }
}
