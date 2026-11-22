import { useEffect, useRef, useState } from 'react'
import { readBrowserCompatibility, type BrowserCompatibility } from '../offline/browser-compatibility.ts'
export function OfflineBrowserSupport() {
  const [result, setResult] = useState<BrowserCompatibility>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  async function check() {
    if (active.current) return
    const c = new AbortController()
    active.current = c
    setBusy(true)
    setError('')
    try {
      const r = await readBrowserCompatibility(c.signal)
      if (!c.signal.aborted) setResult(r)
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message)
    } finally {
      if (active.current === c) {
        active.current = null
        if (!c.signal.aborted) setBusy(false)
      }
    }
  }
  return (
    <details className="wallet-advanced offline-browser-support">
      <summary>Offline browser support</summary>
      <p>Check this browser’s capabilities without contacting your wallet or downloading files.</p>
      <button className="btn" disabled={busy} onClick={() => void check()}>
        {busy ? 'Checking browser…' : 'Check browser support'}
      </button>
      {result && (
        <div role="status">
          <dl>
            <dt>Secure connection</dt>
            <dd>{result.secureContext ? 'Available' : 'Unavailable'}</dd>
            <dt>Service workers</dt>
            <dd>{result.serviceWorkers ? 'Available' : 'Unavailable'}</dd>
            <dt>Cache API</dt>
            <dd>{result.cacheAPI ? 'Exposed' : 'Unavailable'}</dd>
            <dt>Local database API</dt>
            <dd>{result.localDatabase ? 'Exposed' : 'Unavailable'}</dd>
            <dt>Native wallet bridge</dt>
            <dd>{result.nativeWalletBridge ? 'Detected (no wallet request made)' : 'Not detected'}</dd>
            <dt>Saved application files</dt>
            <dd>
              {result.appFiles === 'ready'
                ? 'Confirmed by the active worker'
                : result.appFiles === 'waiting'
                  ? 'App update waiting'
                  : result.appFiles === 'unavailable'
                    ? 'Could not check'
                    : 'Not confirmed'}
            </dd>
          </dl>
          <p>
            {!result.secureContext || !result.serviceWorkers
              ? 'Offline reopening is unavailable through TicketSV’s app cache in this browser. Keep this page open; refreshing or closing it may require internet.'
              : result.appFiles === 'ready'
                ? 'App files are saved. An actual offline reopening test is still required.'
                : 'Prepare this device online before testing offline reopening.'}
          </p>
          {result.appFiles === 'ready' && (
            <p>
              After saving your current progress, disconnect internet and reopen this same address in the same browser. Confirm the ticket
              returns and select Verify locally. Then repeat after closing and restarting the browser.
            </p>
          )}
          <p>This check does not prove browser restart support, wallet signing readiness or ticket validity.</p>
        </div>
      )}
      {error && <p role="status">Browser check unavailable: {error}</p>}
    </details>
  )
}
