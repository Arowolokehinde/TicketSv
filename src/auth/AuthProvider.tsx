import {revokeScannerPermit} from '../scanner/authorization.ts'
import {navigateOnline} from '../navigation/location.ts'
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiFailure, currentAuthEpoch, advanceAuthEpoch, type AuthSession } from './api.ts'

type AuthState = {
  session: AuthSession | null; loading: boolean; error: string; destination: string | null
  open: (destination?: string) => void; close: () => void
  authenticated: (session: AuthSession) => void; logout: () => Promise<void>; refresh: () => Promise<AuthSession | null>
}
const Context = createContext<AuthState | null>(null)
export function useOptionalAuth(): AuthState | null { return useContext(Context) }
export function useAuth(): AuthState { const value = useContext(Context); if (!value) throw new Error('Authentication provider missing'); return value }
export function AuthProvider({ children, offlineSession }: { children: ReactNode; offlineSession?:()=>AuthSession|null }): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState<string | null>(null)
  const generation = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const identity = useRef<string | null>(null)
  const applySession = useCallback((next: AuthSession | null) => {
    if (identity.current !== (next?.identityKey ?? null)) advanceAuthEpoch(next?.identityKey ?? null)
    if(identity.current&&next&&identity.current!==next.identityKey)revokeScannerPermit()
    identity.current = next?.identityKey ?? null
    setSession(next)
  }, [])
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const result = !navigator.onLine&&offlineSession?offlineSession():await api<AuthSession>('/api/auth/session')
      if (current === generation.current) { applySession(result); setError('') }
      return result
    } catch (failure) {
      if(offlineSession&&failure instanceof ApiFailure&&failure.status===0){
        const local=offlineSession()
        if(local&&current===generation.current){applySession(local);setError('');return local}
      }
      if(current===generation.current&&failure instanceof ApiFailure&&failure.status===401)revokeScannerPermit()
      if (current === generation.current) { applySession(null); setError(failure instanceof ApiFailure && failure.status === 401 ? '' : (failure as Error).message) }
      return null
    } finally { if (current === generation.current) setLoading(false) }
  }, [applySession,offlineSession])
  useEffect(() => {
    void refresh()
    const check = () => { void refresh() }
    const expired = (event: Event) => { if ((event as CustomEvent<number>).detail !== currentAuthEpoch()) return; revokeScannerPermit();generation.current++; applySession(null); setLoading(false) }
    const visible = () => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', check)
    if(offlineSession){window.addEventListener('online',check);window.addEventListener('offline',check);window.addEventListener('storage',check)}
    window.addEventListener('ticketsv-session-expired', expired)
    document.addEventListener('visibilitychange', visible)
    channel.current = new BroadcastChannel('ticketsv-session')
    channel.current.onmessage = check
    return () => { generation.current++;window.removeEventListener('online',check);window.removeEventListener('offline',check);window.removeEventListener('storage',check); window.removeEventListener('focus', check); window.removeEventListener('ticketsv-session-expired', expired); document.removeEventListener('visibilitychange', visible); channel.current?.close() }
  }, [refresh,offlineSession])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { applySession(null); void refresh() }, Math.max(0, Date.parse(session.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [session, refresh])
  const authenticated = (next: AuthSession) => {
    revokeScannerPermit()
    generation.current++; setLoading(false); applySession(next); setError(''); setDestination(null)
    channel.current?.postMessage('changed')
    if (destination && destination !== location.pathname && !navigateOnline(destination)) location.assign(destination)
  }
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: '{}' })
    revokeScannerPermit()
    generation.current++; applySession(null); setError(''); setDestination(null); channel.current?.postMessage('changed')
  }
  return <Context.Provider value={{ session, loading, error, destination, refresh, authenticated, logout, open: target => setDestination(target ?? location.pathname), close: () => setDestination(null) }}>{children}</Context.Provider>
}

export function AuthLink({ href, children, className }: { href: string; children: ReactNode; className?: string }): React.JSX.Element {
  const auth = useAuth()
  return <a href={href} className={className} onClick={event => { if (!auth.session) { event.preventDefault(); auth.open(href) } }}>{children}</a>
}
export function RequireAuth({ children }: { children: ReactNode }): React.JSX.Element {
  const auth = useAuth()
  if (auth.loading) return <></>
  if (auth.session) return <Fragment key={auth.session.identityKey}>{children}</Fragment>
  return <main className="development-page"><a className="wordmark" href="/">TicketSV</a><h1>Connect your wallet to continue.</h1><p>Sign in to access your dashboard and manage your events.</p>{auth.error && <p role="alert">{auth.error}</p>}<button className="btn primary" aria-label="Connect wallet" onClick={() => auth.open()}>Connect wallet</button><a className="btn" href="/">Back to home</a></main>
}
