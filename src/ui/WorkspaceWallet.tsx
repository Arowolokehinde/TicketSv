import { useEffect, useRef, useState } from 'react'
import { CONNECTION_TIMEOUT_MS, ConnectionError, type WalletTransport } from '../wallet/connection.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import { signIn } from '../auth/login.ts'

export function WorkspaceWallet(): React.JSX.Element {
  const auth = useAuth()
  return <button className="btn primary workspace-wallet-trigger" aria-label={auth.session ? 'Account' : 'Connect wallet'} onClick={() => auth.open()}>{auth.session ? 'Account' : 'Connect wallet'}</button>
}

export function WalletLoginDialog(): React.JSX.Element {
  const auth = useAuth()
  const evidence = auth.session
  const dialog = useRef<HTMLDialogElement>(null)
  const active = useRef<AbortController | null>(null)
  const [walletKind, setWalletKind] = useState<'desktop' | 'browser'>('desktop')
  const [desktopTransport, setDesktopTransport] = useState<Exclude<WalletTransport, 'browser-native'>>('desktop-http')
  const transport: WalletTransport = walletKind === 'browser' ? 'browser-native' : desktopTransport
  const closeRequested = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (auth.destination !== null && !dialog.current?.open) dialog.current?.showModal()
    if (auth.destination === null) dialog.current?.close()
  }, [auth.destination])

  useEffect(() => () => {
    const controller = active.current
    active.current = null
    controller?.abort(new ConnectionError('cancelled'))
  }, [])

  const cancel = () => { active.current?.abort(new ConnectionError('cancelled')) }
  const close = () => {
    if (active.current) { closeRequested.current = true; cancel(); return }
    setError(null)
    auth.close()
    dialog.current?.close()
  }
  const connect = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    closeRequested.current = false
    setPending(true)
    setError(null)
    const timer = setTimeout(() => controller.abort(new ConnectionError('timeout')), CONNECTION_TIMEOUT_MS)
    try {
      const result = await signIn(transport, controller.signal)
      if (active.current === controller && !controller.signal.aborted) {
        try { sessionStorage.setItem('ticketsv-wallet-transport', transport) } catch { /* Connection preference is optional. */ }
        auth.authenticated(result)
      }
    } catch (failure) {
      if (active.current === controller) {
        if (closeRequested.current && failure === controller.signal.reason) auth.close()
        else setError(failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.')
      }
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }

  return <>
    <dialog ref={dialog} className="workspace-wallet-dialog" aria-labelledby="workspace-wallet-heading" onCancel={event => { event.preventDefault(); close() }}>
      <div className="wallet-dialog-top"><span className="home-eyebrow">YOUR WALLET · BSV TESTNET</span><button className="wallet-dialog-close" aria-label="Close wallet panel" onClick={close}>×</button></div>
      <h2 id="workspace-wallet-heading">{evidence ? 'Your account' : 'Connect your wallet'}</h2>
      <p>{evidence ? 'You are signed in with the wallet identity below.' : 'Connect your testnet wallet and approve a sign-in signature. This proves control of your wallet identity. No ticket transaction or payment is created.'}</p>
      {!evidence && <>
        <fieldset className="wallet-choices" disabled={pending}>
          <legend>Choose your wallet</legend>
          <label className="wallet-choice">
            <input type="radio" name="workspace-wallet-kind" aria-label="BSV Desktop" value="desktop" checked={walletKind === 'desktop'} onChange={() => { setWalletKind('desktop'); setError(null) }} />
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="5" width="24" height="17" rx="2" /><path d="M16 22v5m-6 0h12M5 18h22" /></svg>
            <span><strong>BSV Desktop</strong><small>Wallet on your computer</small></span>
          </label>
          <label className="wallet-choice">
            <input type="radio" name="workspace-wallet-kind" aria-label="BSV Browser" value="browser" checked={walletKind === 'browser'} onChange={() => { setWalletKind('browser'); setError(null) }} />
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="5" width="24" height="22" rx="2" /><path d="M4 12h24M8 8.5h1m3 0h1m3 0h1" /></svg>
            <span><strong>BSV Browser</strong><small>Wallet inside BSV Browser</small></span>
          </label>
        </fieldset>
        <p className="wallet-dialog-help">{walletKind === 'browser' ? 'Open TicketSV inside BSV Browser and select testnet.' : 'Open BSV Desktop and select testnet before connecting.'}</p>
        {walletKind === 'desktop' && <details className="wallet-advanced">
          <summary>Advanced settings</summary>
          <label htmlFor="workspace-wallet-method">Desktop connection</label>
          <select id="workspace-wallet-method" value={desktopTransport} disabled={pending} onChange={event => { setError(null); setDesktopTransport(event.target.value as typeof desktopTransport) }}>
            <option value="desktop-http">Local HTTP (default)</option>
            <option value="desktop-https">Local HTTPS</option>
          </select>
          <p className="wallet-dialog-help">{desktopTransport === 'desktop-http' ? 'Uses localhost:3321. For local testing, open TicketSV at localhost rather than an IP address.' : 'Uses localhost:2121. Choose this only when your wallet has HTTPS enabled and your browser trusts its certificate.'}</p>
        </details>}
      </>}
      <p className="wallet-connection-status" role="status">{pending ? 'Connecting and verifying your sign-in. Review any signature request in your wallet.' : evidence ? 'Signed in to TicketSV.' : 'Ready when your wallet is.'}</p>
      {error && <p className="wallet-dialog-error" role="alert">{error}</p>}
      {evidence && <>
        <dl className="wallet-connection-details">
          <div><dt>Public identity</dt><dd><code>{evidence.identityKey}</code></dd></div>
          
          <div><dt>Session expires</dt><dd><time dateTime={evidence.expiresAt}>{new Date(evidence.expiresAt).toLocaleString()}</time></dd></div>
        </dl>
        <p className="wallet-dialog-help">This session continues across page navigation. Sign out before switching wallet accounts. Wallet access for ticket actions is checked separately.</p>
      </>}
      <details className="wallet-advanced">
        <summary>How wallet permissions work</summary>
        <p className="wallet-dialog-help">Your wallet controls access to your public identity. If you already allowed this site, it may connect without another prompt. TicketSV cannot tell whether a new prompt was shown.</p>
        <p className="wallet-dialog-help">To remove saved access, manage this site’s permissions in your wallet. Signing out here ends the TicketSV session.</p>
      </details>
      <div className="wallet-dialog-actions">
        {evidence ? <button className="btn" disabled={pending} onClick={() => { setPending(true); void auth.logout().catch(failure => setError((failure as Error).message)).finally(() => setPending(false)) }}>Sign out</button> : <button className="btn primary" aria-label="Connect and sign in" disabled={pending} onClick={() => void connect()}>{pending ? 'Connecting…' : 'Connect and sign in'}</button>}
        {pending && <button className="btn" onClick={() => { cancel(); setError('Cancelling sign-in. Dismiss any remaining prompt in your wallet.') }}>Cancel connection</button>}
      </div>
      {!evidence && <small>Sign-in uses authentication signatures only. Your private keys stay in your wallet.</small>}
      {evidence && <small>Signing out does not revoke site permissions saved inside your wallet.</small>}
    </dialog>
  </>
}
