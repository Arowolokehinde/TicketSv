import { useOptionalAuth } from '../auth/AuthProvider.tsx'
import { api, currentAuthEpoch } from '../auth/api.ts'
import { savedScannerPermit, saveScannerPermit } from '../scanner/authorization.ts'
import { useEffect, useRef, useState } from 'react'
import { ExchangeImport } from './HandoffExchange.tsx'
import { DashboardIcon } from './DashboardIcon.tsx'
import { scannerReview, normalizeScannerTicket, verifyScannerTicket } from '../scanner/verify.ts'
import { scannerSetupStore, scannerEvidenceStore, type ScannerSetup } from '../scanner/store.ts'
import { prepareScannerHeaders, scannerJSON } from '../scanner/headers.ts'
import { prepareScannerApp, scannerCacheStatus } from '../scanner/cache.ts'
import { organiserReviewStore, organiserReviewKey } from '../handoff/organiser-review.ts'
import { loadSnapshot } from '../headers/store.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import type { TicketPackage } from '../tickets/types.ts'
import type { PublishedEvent } from '../marketplace/types.ts'
import {
  admissionKey,
  admissionStore,
  admit,
  doorDecision,
  refuse,
  savedSpend,
  type Admission,
  type DoorDecision,
  type SpendCheck,
} from '../scanner/admissions.ts'
import { checkSpent, type SpentList } from '../scanner/spent.ts'
import { prepareSpentList } from '../scanner/prepare-spent.ts'
import { spentListStore } from '../scanner/store.ts'
import { Transaction } from '@bsv/sdk'
import { reconcileAdmission } from '../scanner/reconcile.ts'
import { fetchStatus } from '../settlement/arc.ts'
import { measured } from '../network/recorder.ts'
import { NetworkLine } from './NetworkLine.tsx'
import { evidenceSize, formatEvidence } from '../tickets/size.ts'

type Result = Awaited<ReturnType<typeof verifyScannerTicket>> & { spend?: SpendCheck }
type DoorView = DoorDecision | { kind: 'admitted' }
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const doorState = (a: Admission) =>
  a.reconcile?.state === 'confirmed'
    ? 'Confirmed'
    : a.reconcile?.state === 'lost'
      ? 'Lost the double sale'
      : a.reconcile?.state === 'unknown'
        ? 'Not checked yet'
        : a.admitted.mined
          ? 'Admitted'
          : 'Waiting for mining'
const evidenceLine = (pkg: TicketPackage | undefined) => {
  try {
    return pkg ? formatEvidence(evidenceSize(pkg)) : undefined
  } catch {
    return undefined
  }
}
const spendLine = (s: SpendCheck) =>
  s.source === 'live'
    ? `Spend check: live, ${s.state === 'spent' ? 'spent' : 'not spent'}`
    : `${s.source === 'saved' ? `Spend check: saved list from ${clock(s.checkedAt!)}` : 'Spend check: not available'}${s.liveFailed ? ' (live check failed)' : ''}`
// Online, ask whether this ticket's output was spent; offline or on failure, use
// the list saved at the last preparation.
async function spendCheck(pkg: TicketPackage, eventId: string, signal: AbortSignal): Promise<SpendCheck> {
  const saved = savedSpend(await spentListStore.load(eventId), pkg)
  if (!navigator.onLine) return saved
  try {
    return {
      ...(await checkSpent(Transaction.fromHex(pkg.lineageRawTxs.at(-1)!), pkg.current.index, signal)),
      source: 'live',
      checkedAt: new Date().toISOString(),
    }
  } catch {
    signal.throwIfAborted()
    return { ...saved, liveFailed: true }
  }
}
const labels = {
  rejected: 'Ticket rejected',
  incomplete: 'Verification incomplete',
  'online-check-required': 'Online check required',
  'passes-poc-policy': 'Passes POC door policy',
}
export function ScannerPage() {
  const auth = useOptionalAuth(),
    [accessExpires, setAccessExpires] = useState(() => savedScannerPermit()?.expiresAt)
  async function authoriseOffline(signal: AbortSignal) {
    if (!auth?.session) throw Error('Sign in before preparing offline scanner access.')
    const identity = auth.session.identityKey
    try {
      const permit = await api('/api/auth/scanner-permit', {
        method: 'POST',
        body: '{}',
        signal,
        headers: { 'x-ticketsv-identity': identity },
      })
      signal.throwIfAborted()
      return saveScannerPermit(permit, identity)
    } catch (error) {
      if ((error as { status?: number }).status === 401)
        dispatchEvent(new CustomEvent('ticketsv-session-expired', { detail: currentAuthEpoch() }))
      throw error
    }
  }
  const [setup, setSetup] = useState<ScannerSetup>(),
    [headers, setHeaders] = useState<HeaderSnapshot>(),
    [pkg, setPkg] = useState<TicketPackage>()
  const [events, setEvents] = useState<PublishedEvent[]>([]),
    [selected, setSelected] = useState(''),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [consent, setConsent] = useState(false)
  const [cache, setCache] = useState<Awaited<ReturnType<typeof scannerCacheStatus>>>('missing'),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(location.pathname.includes('/prepare'))
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<Result>()
  const [spentList, setSpentList] = useState<SpentList>(),
    [admissions, setAdmissions] = useState<Admission[]>([]),
    [door, setDoor] = useState<DoorView>(),
    [doorCheck, setDoorCheck] = useState<object>()
  const mounted = useRef(true),
    active = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    void Promise.all([scannerSetupStore.load('active'), loadSnapshot(), scannerEvidenceStore.load('last'), scannerCacheStatus()])
      .then(([saved, snapshot, last, status]) => {
        if (!mounted.current) return
        if (saved && saved.review.origin !== location.origin)
          throw Error('Saved scanner setup belongs to another website. Prepare it here.')
        setSetup(saved)
        setHeaders(snapshot)
        setCache(status)
        setPkg(last?.pkg)
        setEditing(v => v || !saved)
        setLoaded(true)
        if (last) setMessage('Saved ticket evidence loaded. Verify again for a fresh local result.')
      })
      .catch(e => {
        if (mounted.current) {
          setError(e.message)
          setLoaded(true)
        }
      })
    return () => {
      mounted.current = false
      active.current?.abort(Error('Scanner closed'))
    }
  }, [])
  // The door's memory for the prepared event, newest first.
  async function eventAdmissions(eventId: string) {
    return (await admissionStore.list()).filter(a => a.eventId === eventId).sort((a, b) => b.admittedAt.localeCompare(a.admittedAt))
  }
  useEffect(() => {
    let current = true
    if (!setup) {
      setAdmissions([])
      setSpentList(undefined)
      return
    }
    void eventAdmissions(setup.review.eventId)
      .then(list => {
        if (current && mounted.current) setAdmissions(list)
      })
      .catch(() => {})
    void spentListStore
      .load(setup.review.eventId)
      .then(list => {
        if (current && mounted.current) setSpentList(list)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [setup])
  const transfersProgress = (done: number, total: number) => {
    if (mounted.current) setMessage(`Checking ticket transfers ${done}/${total}…`)
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current || !loaded) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    setMessage('')
    setResult(undefined)
    setDoor(undefined)
    try {
      await action(controller.signal)
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Scanner operation failed')
    } finally {
      active.current = null
      if (mounted.current) setBusy(false)
    }
  }
  function loadEvents(more = false) {
    void run(async signal => {
      if (!navigator.onLine) throw Error('Connect to load published events. Saved scanner setup remains available offline.')
      const response = (await scannerJSON(
        `/api/marketplace/events${more && nextOffset !== null ? `?offset=${nextOffset}` : ''}`,
        signal,
      )) as { events: PublishedEvent[]; nextOffset: number | null }
      if (
        !Array.isArray(response.events) ||
        response.events.length > 24 ||
        (response.nextOffset !== null && (!Number.isSafeInteger(response.nextOffset) || response.nextOffset < 0))
      )
        throw Error('Invalid event catalogue response')
      response.events.forEach(p => scannerReview(p, location.origin))
      signal.throwIfAborted()
      if (!mounted.current) return
      setEvents(old => (more ? [...old, ...response.events.filter(p => !old.some(e => e.id === p.id))] : response.events))
      setNextOffset(response.nextOffset)
      setConsent(false)
      if (!response.events.length && !more)
        setMessage('No published events yet. Create and publish an event from the organiser dashboard first.')
    })
  }
  const chosen = events.find(e => e.id === selected)
  function prepare() {
    if (!chosen || !consent) return
    void run(async signal => {
      if (!navigator.onLine) throw Error('Connect before preparing the scanner.')
      const fresh = (await scannerJSON(`/api/marketplace/events/${encodeURIComponent(chosen.id)}`, signal)) as PublishedEvent
      if (fresh.id !== chosen.id || fresh.venueIdentity !== chosen.venueIdentity || fresh.revision !== chosen.revision)
        throw Error('This event changed. Load the events again and review its organiser.')
      const current = await scannerSetupStore.load('active')
      if (JSON.stringify(current) !== JSON.stringify(setup)) throw Error('Scanner setup changed in another tab. Reload before preparing.')
      const previous = await organiserReviewStore.load(organiserReviewKey({ origin: location.origin, eventId: fresh.id }))
      const review = scannerReview(fresh, location.origin, previous)
      const snapshot = await prepareScannerHeaders(signal, text => {
        if (mounted.current) setMessage(text)
      })
      const app = await prepareScannerApp(signal)
      signal.throwIfAborted()
      const list = await prepareSpentList(fresh.id, signal, transfersProgress)
      signal.throwIfAborted()
      await organiserReviewStore.save(review, previous?.revision)
      const saved: ScannerSetup = {
        id: 'active',
        revision: current ? current.revision + 1 : 0,
        review,
        preparedAt: new Date().toISOString(),
      }
      await scannerSetupStore.save(saved, current?.revision)
      signal.throwIfAborted()
      const permit = await authoriseOffline(signal)
      signal.throwIfAborted()
      if (mounted.current) setAccessExpires(permit.expiresAt)
      if (mounted.current) {
        setSetup(saved)
        setSpentList(list)
        setHeaders(snapshot)
        setConsent(false)
        setEditing(false)
        setPkg(undefined)
        setCache(app === 'waiting' ? 'waiting' : await scannerCacheStatus())
        setMessage(
          app === 'waiting'
            ? 'App update saved. Select Reload in the update notice before disconnecting.'
            : 'Event trust, app files and available headers saved. Reload once if instructed below, then test in airplane mode.',
        )
      }
    })
  }
  function refresh() {
    void run(async signal => {
      if (!setup) throw Error('Prepare an event first.')
      if (!navigator.onLine) throw Error('Connect to refresh scanner preparation. Saved evidence can still be verified locally.')
      const snapshot = await prepareScannerHeaders(signal, text => {
        if (mounted.current) setMessage(text)
      })
      const app = await prepareScannerApp(signal)
      signal.throwIfAborted()
      const list = await prepareSpentList(setup.review.eventId, signal, transfersProgress)
      signal.throwIfAborted()
      const permit = await authoriseOffline(signal)
      signal.throwIfAborted()
      if (mounted.current) setAccessExpires(permit.expiresAt)
      if (mounted.current) {
        setSpentList(list)
        setHeaders(snapshot)
        setCache(app === 'waiting' ? 'waiting' : await scannerCacheStatus())
        setMessage('Available headers and app files saved. Verify the ticket again.')
      }
    })
  }
  async function importTicket(value: unknown) {
    await run(async signal => {
      setPkg(undefined)
      const parsed = normalizeScannerTicket(value),
        old = await scannerEvidenceStore.load('last')
      signal.throwIfAborted()
      await scannerEvidenceStore.save({ id: 'last', revision: old ? old.revision + 1 : 0, pkg: parsed }, old?.revision)
      if (mounted.current) {
        setPkg(parsed)
        setMessage('Ticket evidence saved on this device. Verify locally to check it.')
      }
    })
  }
  function verify() {
    if (!setup || !pkg) return
    void run(async signal => {
      const check = async () => {
        signal.throwIfAborted()
        if (JSON.stringify(await scannerSetupStore.load('active')) !== JSON.stringify(setup))
          throw Error('Scanner event trust changed. Reload and verify again.')
      }
      await check()
      const snapshot = await loadSnapshot(),
        checked: Result = await measured(
          'Door ticket check',
          async () => {
            const result = await verifyScannerTicket(pkg, setup.review, snapshot)
            return result.policy === 'passes-poc-policy'
              ? { ...result, spend: await spendCheck(pkg, setup.review.eventId, signal) }
              : result
          },
          { key: r => r.verification },
        )
      await check()
      if ((await loadSnapshot())?.id !== snapshot?.id) throw Error('Saved headers changed during verification. Verify again.')
      const existing = await admissionStore.load(admissionKey(setup.review.eventId, pkg)),
        decision = doorDecision(checked.policy, existing, pkg, checked.spend ?? { state: 'unknown', source: 'none' })
      // A different copy of an admitted ticket is kept as evidence for the online check.
      if (existing && decision.kind === 'already-admitted' && decision.differentCopy) {
        const updated = refuse(existing, pkg, new Date().toISOString())
        if (updated !== existing) await admissionStore.save(updated, existing.revision)
      }
      if (mounted.current) {
        setHeaders(snapshot)
        setResult(checked)
        setDoor(decision)
        setAdmissions(await eventAdmissions(setup.review.eventId))
      }
    })
  }
  function admitTicket() {
    const decision = door
    if (!setup || !pkg || decision?.kind !== 'admit') return
    void run(async signal => {
      const key = admissionKey(setup.review.eventId, pkg)
      if (await admissionStore.load(key)) throw Error('This ticket is already admitted at this door.')
      signal.throwIfAborted()
      await admissionStore.save(admit(undefined, setup.review.eventId, pkg, decision.mined, new Date().toISOString()), undefined)
      if (mounted.current) {
        setDoor({ kind: 'admitted' })
        setAdmissions(await eventAdmissions(setup.review.eventId))
      }
    })
  }
  function checkAdmitted() {
    if (!setup) return
    void run(async signal => {
      if (!navigator.onLine) throw Error('Connect to check admitted tickets. The door memory stays on this device.')
      const snapshot = await prepareScannerHeaders(signal, text => {
        if (mounted.current) setMessage(text)
      })
      const summary = await measured('Door check', async () => {
        let checked = 0
        for (const record of await eventAdmissions(setup.review.eventId)) {
          if (record.reconcile?.state === 'confirmed') continue
          const next = await reconcileAdmission(
            record,
            setup.review.venueIdentity,
            { status: fetchStatus, snapshot },
            signal,
            new Date().toISOString(),
          )
          await admissionStore.save(next, record.revision)
          checked++
        }
        return { checked }
      })
      if (mounted.current) {
        setDoorCheck(summary)
        setAdmissions(await eventAdmissions(setup.review.eventId))
        setMessage(`Checked ${summary.checked} admitted ticket${summary.checked === 1 ? '' : 's'}.`)
      }
    })
  }
  // Step 1 prepares the scanner; once prepared, step 2 (checking) leads and step 1 sits beside it.
  const aside = (
    <>
      <aside className="scanner-setup scanner-panel">
        <span className="scanner-eyebrow scanner-step">{setup ? 'STEP 1 · PREPARED' : 'STEP 1 · WHILE ONLINE'}</span>
        <div className="scanner-section-title">
          <DashboardIcon name="prepare" />
          <h2>{setup ? 'This scanner' : 'Prepare this scanner'}</h2>
        </div>
        {setup && (
          <>
            {accessExpires && (
              <p className="scanner-note">
                Offline scanner access until {new Date(accessExpires).toLocaleString()}. Refresh preparation online before it expires.
              </p>
            )}
            <span className="scanner-eyebrow">SELECTED EVENT</span>
            <h3>{setup.review.event.name}</h3>
            <p>{setup.review.event.venue}</p>
            <dl className="scanner-facts">
              <div>
                <dt>Saved headers</dt>
                <dd>{headers ? `Through ${headers.headers.at(-1)!.height.toLocaleString()}` : 'Not saved'}</dd>
              </div>
              <div>
                <dt>Ticket transfers</dt>
                <dd>
                  {spentList
                    ? `Checked ${clock(spentList.checkedAt)}, ${spentList.tickets.length} ticket${spentList.tickets.length === 1 ? '' : 's'}`
                    : 'Not saved (organiser only)'}
                </dd>
              </div>
              <div>
                <dt>Offline app</dt>
                <dd>
                  {cache === 'ready'
                    ? 'Saved and active'
                    : cache === 'reload'
                      ? 'Reload required'
                      : cache === 'waiting'
                        ? 'Update waiting'
                        : 'Preparation required'}
                </dd>
              </div>
            </dl>
            <details>
              <summary>Reviewed organiser identity</summary>
              <code>{setup.review.venueIdentity}</code>
              <p>
                Published revision {setup.review.publicationRevision}. Reviewed {new Date(setup.review.reviewedAt).toLocaleString()}.
              </p>
            </details>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={refresh}>
                Refresh preparation
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setEditing(v => !v)
                  setResult(undefined)
                  setConsent(false)
                }}
              >
                Change event
              </button>
            </div>
            {cache === 'reload' && (
              <a className="btn primary" href="/scanner">
                Reload scanner
              </a>
            )}
            {cache === 'waiting' && (
              <p className="scanner-note">An update is saved. Select Reload in the update notice before disconnecting.</p>
            )}
          </>
        )}
        {editing && (
          <div className="scanner-event-setup">
            <p>
              While online, choose the event and review its organiser before saving this scanner. A ticket cannot choose your trusted
              organiser.
            </p>
            <button className="btn" disabled={busy || !loaded} onClick={() => loadEvents()}>
              Load published events
            </button>
            {events.length > 0 && (
              <>
                <label htmlFor="scanner-event">Event</label>
                <select
                  id="scanner-event"
                  value={selected}
                  disabled={busy}
                  onChange={e => {
                    setSelected(e.target.value)
                    setConsent(false)
                    setResult(undefined)
                  }}
                >
                  <option value="">Choose an event</option>
                  {events.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {nextOffset !== null && (
              <button className="btn" disabled={busy} onClick={() => loadEvents(true)}>
                More events
              </button>
            )}
            {chosen && (
              <div className="scanner-review">
                <strong>{chosen.name}</strong>
                <p>
                  {chosen.date} · {chosen.venue}
                </p>
                <details>
                  <summary>Organiser identity from this published event</summary>
                  <code>{chosen.venueIdentity}</code>
                </details>
                <p>Confirm this is your intended event and organiser. Publication alone does not prove a real-world identity.</p>
                <label className="scanner-consent">
                  <input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />I have checked the
                  event and organiser for this scanner.
                </label>
                <button className="btn primary" aria-label="Save event and prepare offline" disabled={busy || !consent} onClick={prepare}>
                  Save event and prepare offline
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  )
  const check = (
    <>
      <section className="scanner-panel scanner-check">
        <span className="scanner-eyebrow scanner-step">STEP 2 · AT THE DOOR</span>
        <div className="scanner-section-title">
          <DashboardIcon name="scan" />
          <h2>Check a ticket</h2>
        </div>
        <p>Scan the holder’s ticket QR or load their updated ticket file.</p>
        <ExchangeImport label="ticket" scanFirst disabled={busy || !loaded} onLoad={importTicket} />
        {pkg && (
          <div className="scanner-loaded">
            <span className="scanner-eyebrow">LOADED EVIDENCE</span>
            <strong>Ticket {pkg.issuance.ticketId}</strong>
            <code>
              {pkg.current.txid}.{pkg.current.index}
            </code>
            <button className="btn primary" aria-label="Verify locally" disabled={busy || !setup} onClick={verify}>
              Verify locally
            </button>
          </div>
        )}
        {door && (
          <div className={`scanner-door scanner-door-${door.kind}`} aria-live="polite">
            {door.kind === 'needs-mining' && (
              <p>
                <strong>Not admitted</strong>
              </p>
            )}
            {door.kind === 'transferred' && (
              <p>
                <strong>Not admitted: this ticket has been transferred to someone else.</strong>
              </p>
            )}
            {door.kind === 'unchecked' && (
              <p>
                <strong>Not admitted: this door can't check whether the ticket was transferred. Reconnect or refresh preparation.</strong>
              </p>
            )}
            {door.kind === 'admit' && (
              <button className="btn primary" aria-label="Admit" disabled={busy} onClick={admitTicket}>
                Admit
              </button>
            )}
            {door.kind === 'admitted' && (
              <p>
                <strong>Admitted</strong>
              </p>
            )}
            {door.kind === 'already-admitted' && (
              <>
                <p>
                  <strong>{`Already admitted at this door at ${clock(door.at)}`}</strong>
                </p>
                {door.differentCopy && <p>This is a different copy of the same ticket. It may have been sold twice.</p>}
              </>
            )}
          </div>
        )}
        {result && (
          <section className={`scanner-result scanner-result-${result.policy}`} aria-live="polite">
            <span className="scanner-eyebrow">LOCAL RESULT</span>
            <h3>{labels[result.policy]}</h3>
            <ul>
              {result.verification.checks.map((c, i) => (
                <li key={`${c.name}-${i}`}>
                  <strong>
                    {c.name === 'recipient' ? 'Output binding' : c.name}: {c.status}
                  </strong>
                  <span>{c.reason}</span>
                </li>
              ))}
            </ul>
            <p>
              {result.verification.presentedTransferMined
                ? 'Presented transfer mining verified against saved headers.'
                : 'Presented transfer mining is not verified.'}
            </p>
            {evidenceLine(pkg) && <p>Ticket evidence: {evidenceLine(pkg)}</p>}
            {result.spend && <p>{spendLine(result.spend)}</p>}
            <NetworkLine of={result.verification} />
            {result.policy === 'incomplete' && (
              <p>Reconnect and refresh preparation for missing headers, or obtain a ticket file containing complete mining evidence.</p>
            )}
            {result.policy === 'online-check-required' && (
              <p>
                This transfer isn't mined yet, so it can't be admitted. The holder must publish it, wait for mining, select Verify mining
                evidence and show the updated door ticket.
              </p>
            )}
          </section>
        )}
        {setup && admissions.length > 0 && (
          <section className="scanner-admissions" aria-label="Admitted at this door">
            <h3>Admitted at this door</h3>
            <ul>
              {admissions.map(a => (
                <li key={a.id} data-state={a.reconcile?.state ?? (a.admitted.mined ? 'admitted' : 'waiting')}>
                  <time>{clock(a.admittedAt)}</time>
                  <span>Ticket {a.admitted.pkg.issuance.ticketId.slice(0, 8)}</span>
                  <strong>{doorState(a)}</strong>
                  {a.refused.length > 0 && (
                    <small>
                      {a.refused.length} other cop{a.refused.length === 1 ? 'y' : 'ies'} refused
                    </small>
                  )}
                  {a.reconcile?.state === 'lost' && (
                    <small>
                      Admitted copy <code>{a.admitted.txid.slice(0, 12)}…</code> lost to{' '}
                      <code>{a.reconcile.winnerTxid?.slice(0, 12)}…</code>
                    </small>
                  )}
                </li>
              ))}
            </ul>
            <button className="btn" disabled={busy} onClick={checkAdmitted}>
              Check admitted tickets
            </button>
            {doorCheck && <NetworkLine of={doorCheck} />}
          </section>
        )}
      </section>
    </>
  )
  return (
    <main className="scanner-page" id="main">
      <div className="handoff-page-heading scanner-heading">
        <div>
          <span className="handoff-eyebrow">
            <DashboardIcon name="scan" />
            AT THE ENTRANCE
          </span>
          <h1>Scan a ticket.</h1>
          <p>Prepare once while online. Then check tickets here, with or without internet.</p>
        </div>
        <div className="handoff-heading-symbol" aria-hidden="true">
          <DashboardIcon name="ticket" />
        </div>
      </div>
      <div className={`scanner-layout${setup ? '' : ' scanner-layout-setup'}`}>
        {setup ? (
          <>
            {check}
            {aside}
          </>
        ) : (
          <>
            {aside}
            <div className="scanner-later">
              <span className="scanner-eyebrow scanner-step">STEP 2 · AT THE DOOR</span>
              <p>Check tickets here once this scanner is prepared.</p>
            </div>
          </>
        )}
      </div>
      {busy && (
        <p className="scanner-message" role="status">
          {message || 'Working…'}{' '}
          <button className="btn" onClick={() => active.current?.abort(Error('Cancelled. Saved progress retained.'))}>
            Cancel
          </button>
        </p>
      )}
      {!busy && message && (
        <p className="scanner-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="scanner-error" role="alert">
          {error}
        </p>
      )}
      <footer className="scanner-limits">
        <DashboardIcon name="headers" />
        <div>
          <strong>Evidence checked here. Only a mined ticket is admitted, and the door remembers it on this device only.</strong>
          <p>
            Mined inclusion does not prove current unspentness, presenter key control or that a ticket has not been reused. An unseen
            double-sale can pass offline authenticity checks. Full difficulty adjustment and best-chain selection are outside this POC.
          </p>
        </div>
      </footer>
    </main>
  )
}
