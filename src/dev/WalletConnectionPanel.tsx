import { useEffect, useRef, useState } from 'react'
import { CONNECTION_TIMEOUT_MS, ConnectionError, connectWallet, type ConnectionEvidence, type ProbeCall, type WalletTransport } from '../wallet/connection.ts'

export function WalletConnectionPanel(): React.JSX.Element {
  const [transport, setTransport] = useState<WalletTransport>('desktop-http')
  const [pending, setPending] = useState(false)
  const [evidence, setEvidence] = useState<ConnectionEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calls, setCalls] = useState<ProbeCall[]>([])
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => {
    const previous = active.current
    active.current = null
    previous?.abort(new ConnectionError('cancelled'))
  }, [])

  const reset = () => {
    const previous = active.current
    active.current = null
    previous?.abort(new ConnectionError('cancelled'))
    setPending(false); setEvidence(null); setError(null); setCalls([])
  }
  const connect = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setPending(true); setEvidence(null); setError(null); setCalls([])
    const timer = setTimeout(() => controller.abort(new ConnectionError('timeout')), CONNECTION_TIMEOUT_MS)
    try {
      const result = await connectWallet(transport, controller.signal, entry => {
        if (active.current === controller) setCalls(previous => [...previous, entry])
      })
      if (active.current === controller && !controller.signal.aborted) setEvidence(result)
    } catch (failure) {
      if (active.current === controller) setError(failure instanceof ConnectionError ? failure.message : new ConnectionError('request-failed').message)
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }
  return <section className="wallet-panel" aria-labelledby="wallet-heading">
    <h2 id="wallet-heading">Connect your wallet.</h2>
    <p>Read the selected wallet’s network, version and public identity key. No transaction will be created, signed or broadcast.</p>
    <label htmlFor="wallet-transport">Wallet connection method</label>
    <select id="wallet-transport" value={transport} disabled={pending || !!evidence} onChange={event => { reset(); setTransport(event.target.value as WalletTransport) }}>
      <option value="desktop-http">BSV Desktop — local HTTP (3321)</option>
      <option value="desktop-https">BSV Desktop — local HTTPS (2121)</option>
      <option value="browser-native">BSV Browser — native bridge</option>
    </select>
    <p className="wallet-help">For local testing, open this app using localhost in the address bar; BSV Desktop rejects IP-address originators. Use the connection your wallet exposes. HTTPS requires a certificate your browser trusts; the app never bypasses certificate checks or falls back to a relay.</p>
    <p role="status">{pending ? 'Waiting for the wallet. Review any permission prompt.' : evidence ? 'Connection observed this session.' : 'Wallet: not connected'}</p>
    {error && <p className="wallet-error" role="alert">{error}</p>}
    <div className="actions">
      {!evidence && <button className="btn primary" aria-label="Connect wallet" disabled={pending} onClick={() => void connect()}>Connect wallet</button>}
      {pending && <button className="btn" onClick={() => active.current?.abort(new ConnectionError('cancelled'))}>Cancel connection</button>}
      {evidence && <button className="btn" onClick={reset}>Clear connection result</button>}
    </div>
    {evidence && <div className="wallet-evidence">
      <dl><dt>Reported network</dt><dd>{evidence.network}</dd><dt>Reported wallet version</dt><dd>{evidence.version}</dd><dt>Public identity key</dt><dd><code data-testid="wallet-identity">{evidence.identityKey}</code></dd><dt>Observed at</dt><dd>{evidence.checkedAt}</dd></dl>
      <p>This is a read-only observation, not proof of signing ability, a trusted venue identity or offline readiness. Reconnect after changing wallet profiles or networks. Reloading or clearing this result forgets it; neither revokes wallet permissions.</p>
    </div>}
    <details className="wallet-call-log"><summary>App-observed wallet calls ({calls.length})</summary>
      <p>{transport === 'browser-native' ? 'Native bridge calls' : 'Localhost wallet calls'}. Arguments and responses are not logged. Native wallet network traffic is not observed here.</p>
      {calls.length ? <ol>{calls.map((call, index) => <li key={index}><code>{call.method}</code> — {call.status}</li>)}</ol> : <p>No wallet calls made by this panel.</p>}
    </details>
  </section>
}
