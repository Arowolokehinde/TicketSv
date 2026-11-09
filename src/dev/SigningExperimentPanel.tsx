import { useEffect, useRef, useState } from 'react'
import type { WalletInterface } from '@bsv/sdk'
import { openWalletClient } from '../wallet/connection.ts'
import type { FinalEvidence, SigningPreparation } from '../wallet/signing-experiment.ts'
import { summarizeError, type ErrorSummary, type WalletFailureResponse } from '../wallet/diagnostics.ts'

type ExperimentModule = typeof import('../wallet/signing-experiment.ts')
const permitted = new Set(['getNetwork', 'getPublicKey', 'listOutputs', 'createSignature', 'createAction', 'signAction'])
type FailureDetails = ErrorSummary & { phase: string; method: string | null; observedAt: string; walletResponse?: WalletFailureResponse }
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SigningExperimentPanel(): React.JSX.Element {
  const [funded, setFunded] = useState(false)
  const [isolated, setIsolated] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failureDetails, setFailureDetails] = useState<FailureDetails | null>(null)
  const [prepared, setPrepared] = useState<SigningPreparation | null>(null)
  const [final, setFinal] = useState<FinalEvidence | null>(null)
  const [references, setReferences] = useState<string[]>([])
  const [calls, setCalls] = useState<string[]>([])
  const active = useRef<AbortController | null>(null)
  const module = useRef<ExperimentModule | null>(null)
  useEffect(() => () => { const previous = active.current; active.current = null; previous?.abort() }, [])

  const run = async (phase: 'prepare' | 'transfer' | 'restore', file?: File) => {
    if (active.current || error || final || (phase !== 'transfer' && started)) return
    const controller = new AbortController()
    active.current = controller
    setStarted(true); setBusy(true)
    const current = () => active.current === controller && !controller.signal.aborted
    const record = (value: string) => { if (current()) setReferences(previous => [...previous, value]) }
    let timer: ReturnType<typeof setTimeout> | undefined
    let method: string | null = null
    let walletResponse: WalletFailureResponse | undefined
    try {
      await Promise.race([
        (async () => {
          module.current ??= await import('../wallet/signing-experiment.ts')
          controller.signal.throwIfAborted()
          if (phase === 'restore' && (!file || file.size > 4 * 1024 * 1024)) {
            throw new module.current.SigningError('Choose a saved preparation JSON smaller than 4 MiB.')
          }
          const saved = phase === 'restore' ? await file!.text() : undefined
          controller.signal.throwIfAborted()
          const client = await openWalletClient('desktop-http', controller.signal, response => { if (current()) walletResponse = response })
          const observed = new Proxy(client, { get(target, name) {
            if (typeof name !== 'string' || !permitted.has(name)) throw new Error('Unsupported experiment method')
            return async (...args: unknown[]) => {
              controller.signal.throwIfAborted()
              method = name
              if (current()) setCalls(previous => [...previous, `${name} — started`])
              try {
                const method = target[name as keyof WalletInterface] as (...values: unknown[]) => Promise<unknown>
                const result = await method.apply(target, args)
                controller.signal.throwIfAborted()
                if (current()) setCalls(previous => [...previous, `${name} — returned`])
                return result
              } catch (failure) {
                if (current()) setCalls(previous => [...previous, `${name} — failed`])
                throw failure
              }
            }
          } })
          if (phase === 'prepare') {
            const result = await module.current.prepareSigning(observed, crypto.randomUUID(), record)
            if (current()) setPrepared(result)
          } else if (phase === 'restore') {
            const result = await module.current.restorePreparation(observed, saved!)
            if (current()) { setPrepared(result); setDownloaded(true) }
          } else if (prepared) {
            const result = await module.current.transferSigning(observed, prepared, record)
            if (current()) setFinal(result)
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, 60_000)
        }),
      ])
    } catch (failure) {
      if (active.current === controller) setFailureDetails({ ...summarizeError(failure), phase, method, walletResponse, observedAt: new Date().toISOString() })
      if (active.current === controller) setError(controller.signal.aborted ? 'The wallet attempt timed out. Its outcome may be unknown.'
        : module.current && failure instanceof module.current.SigningError ? failure.message
        : 'The wallet request or evidence check failed. Check test funds, wallet permissions and connectivity.')
    } finally {
      clearTimeout(timer)
      if (active.current === controller) { active.current = null; setBusy(false) }
    }
  }

  return <section className="wallet-panel signing-panel" aria-labelledby="signing-heading">
    <h2 id="signing-heading">Offline signing experiment.</h2>
    <p>A one-satoshi PushDrop test token moves between two keys in your own BSV Desktop wallet. This diagnostic is separate from venue issuance and the two-person handoff.</p>
    <p>Desktop HTTP only. Open this page at localhost. Preparation needs testnet funds for the token and fees. Both transactions use noSend: true; the wallet may reserve funding inputs even though nothing is broadcast.</p>
    <h3>1. Prepare while online</h3>
    <p>Already saved a preparation? After resolving any pending wallet action, load it here while online. Loading checks the saved evidence, wallet keys and output availability without creating a transaction.</p>
    <label htmlFor="signing-preparation-file">Load saved preparation</label>
    <input id="signing-preparation-file" type="file" accept=".json,application/json" style={{ maxWidth: '100%' }} disabled={started}
      onChange={event => { const file = event.target.files?.[0]; if (file) void run('restore', file) }} />
    <label className="experiment-check"><input type="checkbox" checked={funded} disabled={started} onChange={event => setFunded(event.target.checked)} />I have test funds and understand this reserves wallet inputs.</label>
    <button className="btn" aria-label="Prepare signing fixture" disabled={!funded || started} onClick={() => void run('prepare')}>Prepare signing fixture</button>
    {prepared && <>
      <p>Preparation returned signed bytes. Source transaction: <code className="experiment-id">{prepared.source.txid}</code> ({prepared.source.atomicBeef.length.toLocaleString()} bytes).</p>
      <button className="btn" onClick={() => { download('counterfoil-signing-preparation.json', prepared); setDownloaded(true) }}>Download preparation</button>
      <h3>2. Disconnect external networking, keep the local wallet running</h3>
      <p>Save the preparation download first. Keep this tab open. Disable external internet access for both the browser and BSV Desktop while retaining localhost. Browser emulation or an empty app log alone does not establish this. Offline reopening is not implemented.</p>
      <label className="experiment-check"><input type="checkbox" checked={isolated} disabled={busy || !!final || !!error} onChange={event => setIsolated(event.target.checked)} />I have saved the preparation and isolated external networking for the app and wallet.</label>
      <button className="btn" aria-label="Attempt transfer signing" disabled={!downloaded || !isolated || busy || !!final || !!error} onClick={() => void run('transfer')}>Attempt transfer signing</button>
    </>}
    {busy && <p role="status">Waiting for the wallet; review its permission prompt. This attempt stops waiting after 60 seconds.</p>}
    {error && <div role="alert" className="wallet-error"><p>{error}</p><p>Do not repeat preparation or signing until wallet state has been reviewed. A failed or lost response may leave an action or reserved inputs. Reloading does not undo them.</p>
      {failureDetails && <>
        <details><summary>Error details</summary><p>Reported by the SDK or wallet; these details do not establish whether a wallet action was created.</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(failureDetails, null, 2)}</pre>
        </details>
        <button className="btn" onClick={() => download('counterfoil-signing-failure.json', { kind: 'counterfoil-signing-failure', failure: failureDetails, calls, references })}>Download failure details</button>
      </>}
    </div>}
    {final && <div className="wallet-evidence">
      <p role="status">Final signed bytes returned; local script checks passed.</p>
      <p>Transaction: <code className="experiment-id">{final.txid}</code> ({final.atomicBeef.length.toLocaleString()} bytes).</p>
      <p>Chain anchors were not checked. This is not an SPV verdict, a trusted venue ticket, or a proven two-device handoff. External isolation was operator-reported and still needs recorded evidence.</p>
      <button className="btn" onClick={() => download('counterfoil-signing-result.json', { kind: 'counterfoil-signing-result', network: 'testnet', preparation: prepared, final, references, isolation: 'operator-reported', checks: 'scripts-only', observedAt: new Date().toISOString() })}>Download signing result</button>
    </div>}
    {references.length > 0 && <details><summary>Wallet action references</summary><p>Keep these for manual review of reserved inputs. They are not proof of broadcast or revocation.</p><ul>{references.map((value, i) => <li key={i}><code className="experiment-id">{value}</code></li>)}</ul></details>}
    <details><summary>Experiment wallet calls ({calls.length})</summary><p>Method names only; native wallet network traffic is not observed.</p><ol>{calls.map((call, i) => <li key={i}>{call}</li>)}</ol></details>
    <p>Experiment state stays in this tab. A saved preparation can be loaded again while online; it is diagnostic evidence, not ticket acceptance or a wallet backup. No live offline result is recorded by these controls automatically.</p>
  </section>
}
