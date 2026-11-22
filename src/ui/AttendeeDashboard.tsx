import { synchroniseReceivedTickets } from '../handoff/sync.ts'
import { headerProgressText, SHARED_HEADER_TRUST, SHARED_HEADERS_ENABLED } from '../headers/cached-sync.ts'
import { useEffect, useRef, useState } from 'react'
import { api, currentAuthEpoch, currentAuthIdentity } from '../auth/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { AttendeeRequest, AttendeeTicket } from '../marketplace/types.ts'
import type { VenueIssuance } from '../events/issuance-types.ts'
import type { Verification } from '../tickets/types.ts'
import type { HeaderSyncProgress } from '../headers/sync.ts'
import { recipientStore } from '../handoff/store.ts'
import { settlementStore, type HandoffSettlement } from '../handoff/settlement.ts'
import type { HandoffTicket } from '../handoff/types.ts'
import { SaveOfflineTicket } from './SaveOfflineTicket.tsx'
import { PrepareTicketWallet } from './PrepareTicketWallet.tsx'
import { eventDate } from './VenueEvents.tsx'
import { DashboardIcon } from './DashboardIcon.tsx'
import { TicketQR } from './TicketQR.tsx'
import '../styles/marketplace.css'
import '../styles/attendee-steps.css'
import { measured } from '../network/recorder.ts'
import { NetworkLine } from './NetworkLine.tsx'

type DashboardHandoff = { ticket: HandoffTicket; settlement?: HandoffSettlement; href: string }
const requestStatus = {
  requested: 'Awaiting approval',
  prepared: 'Under review',
  pending: 'Issuance pending',
  complete: 'Ticket delivered',
}
export function AttendeeDashboard() {
  const { session } = useAuth(),
    owner = session!.identityKey
  const [tickets, setTickets] = useState<AttendeeTicket[]>([]),
    [requests, setRequests] = useState<AttendeeRequest[]>([])
  const [handoffs, setHandoffs] = useState<DashboardHandoff[]>([]),
    [handoffError, setHandoffError] = useState('')
  const [ticketNext, setTicketNext] = useState<number | null>(null),
    [requestNext, setRequestNext] = useState<number | null>(null)
  const [selected, setSelected] = useState<VenueIssuance>(),
    [report, setReport] = useState<Verification>(),
    [progress, setProgress] = useState<HeaderSyncProgress>()
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false)
  const [miningReady, setMiningReady] = useState(false),
    [offlineReady, setOfflineReady] = useState(false)
  const [walletPresent, setWalletPresent] = useState(false)
  const verified = report?.verdict === 'verified' && report.presentedTransferMined
  const ticketStep = !miningReady ? 0 : !verified ? 1 : !offlineReady ? 2 : walletPresent ? 4 : 3
  const active = useRef<AbortController | null>(null),
    mounted = useRef(true),
    walletOperation = useRef(false)
  const background = useRef<AbortController | null>(null),
    backgroundExplicit = useRef(false),
    lastLoad = useRef(0)
  const [refreshing, setRefreshing] = useState<false | 'quiet' | 'explicit'>(false)
  async function perform(action: (signal: AbortSignal, check: () => void) => Promise<void>, usesWallet = false) {
    if (active.current) return
    // The person's own action always wins over a quiet background refresh.
    if (background.current && !backgroundExplicit.current) {
      background.current.abort()
      background.current = null
    }
    const controller = new AbortController(),
      epoch = currentAuthEpoch()
    active.current = controller
    walletOperation.current = usesWallet
    setBusy(true)
    setError('')
    setNotice('')
    setProgress(undefined)
    const check = () => {
      controller.signal.throwIfAborted()
      if (!mounted.current || currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner)
        throw Error('The signed-in account changed. Reopen your Dashboard.')
    }
    try {
      await action(controller.signal, check)
    } catch (e) {
      if (mounted.current && active.current === controller) setError((e as Error).message)
    } finally {
      if (active.current === controller) {
        active.current = null
        if (mounted.current) setBusy(false)
      }
      controller.abort()
    }
  }
  async function reload() {
    await refresh({ explicit: true })
  }
  async function load(signal: AbortSignal, check: () => void) {
    // Handoff evidence is saved on this device, separately from original
    // server deliveries. Load it even when the delivery API is unavailable.
    try {
      const [received, settled] = await Promise.all([recipientStore.list(), settlementStore.list()])
      check()
      const local = new Map<string, DashboardHandoff>()
      const matches = (t: HandoffTicket) => t.holder === owner && !!t.request
      const key = (t: HandoffTicket) => `${t.pkg.current.txid}.${t.pkg.current.index}`
      for (const r of received)
        if (r.ticket && matches(r.ticket))
          local.set(key(r.ticket), { ticket: r.ticket, href: `/offline/handoff?request=${encodeURIComponent(r.id)}` })
      // The settlement carries the latest mining package and wallet observations.
      // It may also exist without a recipient record on this browser.
      for (const r of settled)
        if (matches(r.ticket))
          local.set(key(r.ticket), { ticket: r.ticket, settlement: r, href: `/offline/handoff?transfer=${encodeURIComponent(r.id)}` })
      setHandoffs([...local.values()].sort((a, b) => Date.parse(b.ticket.savedAt) - Date.parse(a.ticket.savedAt)))
      setHandoffError('')
    } catch (error) {
      check()
      setHandoffs([])
      setHandoffError(`Received handoffs could not be loaded: ${(error as Error).message}`)
    }
    if (navigator.onLine)
      try {
        await synchroniseReceivedTickets(owner, signal, { recipients: recipientStore, settlements: settlementStore, request: api, check })
        check()
        const synced = await settlementStore.list()
        check()
        setHandoffs(
          synced
            .filter(r => r.ticket.holder === owner && r.ticket.request)
            .map(r => ({ ticket: r.ticket, settlement: r, href: `/offline/handoff?transfer=${encodeURIComponent(r.id)}` })),
        )
      } catch (syncError) {
        check()
        setNotice(`Account synchronisation needs attention: ${(syncError as Error).message} Device copies are retained.`)
      }
    const [collection, inbox] = await Promise.all([
      api<{ tickets: AttendeeTicket[]; nextOffset: number | null }>('/api/tickets', { signal }),
      api<{ requests: AttendeeRequest[]; nextOffset: number | null }>('/api/tickets/requests', { signal }),
    ])
    check()
    setTickets(collection.tickets)
    setTicketNext(collection.nextOffset)
    setRequests(inbox.requests)
    setRequestNext(inbox.nextOffset)
    setLoaded(true)
    lastLoad.current = Date.now()
  }
  // Loading never shows a status line or blocks clicks; only the Refresh icon
  // turns. Loads the person asked for (opening, Refresh) report errors. Returning
  // to the window refreshes quietly, at most once a minute.
  async function refresh({ explicit = false, force = false }: { explicit?: boolean; force?: boolean } = {}) {
    if (active.current || (!explicit && !navigator.onLine)) return
    if (background.current) {
      if (!explicit) return
      background.current.abort()
      background.current = null
    }
    if (!explicit && !force && Date.now() - lastLoad.current < 60_000) return
    const controller = new AbortController(),
      epoch = currentAuthEpoch()
    background.current = controller
    backgroundExplicit.current = explicit
    const check = () => {
      controller.signal.throwIfAborted()
      if (!mounted.current || currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner)
        throw Error('The signed-in account changed. Reopen your Dashboard.')
    }
    setRefreshing(explicit ? 'explicit' : 'quiet')
    if (explicit) setError('')
    try {
      await load(controller.signal, check)
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && background.current === controller) {
        if (explicit) setError((failure as Error).message)
        else setNotice('Could not refresh. Showing the last loaded tickets.')
      }
    } finally {
      if (background.current === controller) {
        background.current = null
        if (mounted.current) setRefreshing(false)
      }
      controller.abort()
    }
  }
  useEffect(() => {
    mounted.current = true
    void reload()
    const reconnect = () => void refresh({ force: true }),
      focus = () => void refresh()
    addEventListener('online', reconnect)
    addEventListener('focus', focus)
    return () => {
      mounted.current = false
      active.current?.abort()
      active.current = null
      background.current?.abort()
      background.current = null
      removeEventListener('online', reconnect)
      removeEventListener('focus', focus)
    }
  }, [])
  function more(kind: 'tickets' | 'requests') {
    const offset = kind === 'tickets' ? ticketNext : requestNext
    if (offset === null) return
    void perform(async (signal, check) => {
      if (kind === 'tickets') {
        const result = await api<{ tickets: AttendeeTicket[]; nextOffset: number | null }>(`/api/tickets?offset=${offset}`, { signal })
        check()
        setTickets(items => [...items, ...result.tickets.filter(t => !items.some(i => i.id === t.id))])
        setTicketNext(result.nextOffset)
      } else {
        const result = await api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/tickets/requests?offset=${offset}`, {
          signal,
        })
        check()
        setRequests(items => [...items, ...result.requests.filter(t => !items.some(i => i.id === t.id))])
        setRequestNext(result.nextOffset)
      }
    })
  }
  function open(id: string) {
    void perform(async (signal, check) => {
      let record = await api<VenueIssuance>(`/api/tickets/${id}`, { signal })
      check()
      const { verifyRequestProof } = await import('../marketplace/request-proof.ts')
      check()
      if (!record.attendeeProof) throw Error('The independently saved receiving request is missing.')
      const attendeeProof = record.attendeeProof
      verifyRequestProof(attendeeProof, {
        eventId: record.eventId,
        revision: record.eventRevision,
        venue: record.owner,
        attendee: owner,
        origin: location.origin,
      })
      let restored = false
      try {
        const { listSavedTickets } = await import('../offline/attendee-store.ts')
        const { restoreAttendeeMiningEvidence } = await import('../offline/attendee-evidence.ts')
        check()
        const saved = (await listSavedTickets(location.origin)).find(
          row => row.evidence?.id === record.id && row.evidence.attendee === owner,
        )
        check()
        if (saved?.evidence) {
          record = restoreAttendeeMiningEvidence(record, saved.evidence, owner, location.origin)
          restored = true
        }
      } catch {
        // Missing, inaccessible or mismatched device data must not prevent access
        // to the authenticated delivery. Fresh verification still runs below.
        check()
      }
      let resumedReport: Verification | undefined,
        resumedMining = false,
        resumedOffline = false
      if (restored && record.pkg) {
        const { Transaction } = await import('@bsv/sdk'),
          { fromBase64 } = await import('../tickets/codec.ts')
        check()
        resumedMining = !!Transaction.fromAtomicBEEF(fromBase64(record.pkg.atomicBeefBase64)).merklePath
        if (resumedMining) {
          const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts')
          check()
          // Recompute the verdict from the actual evidence and current local headers.
          // Reopening never fetches proofs, contacts a wallet, or restores a saved verdict.
          try {
            resumedReport = await measured('Ticket verification', () =>
              verifyVenueTicket(record.pkg!, {
                trustedVenueIdentity: attendeeProof.venue,
                expectedRequest: attendeeProof.request,
                online: false,
                signal,
              }),
            )
            check()
            const { attendeeAppStatus } = await import('../offline/attendee-cache.ts')
            check()
            resumedOffline = (await attendeeAppStatus(signal)) === 'ready'
            check()
            if (!resumedOffline && resumedReport.verdict === 'verified' && resumedReport.presentedTransferMined)
              setNotice('Saved ticket restored and checked locally. Confirm the offline app files to finish preparing this device.')
          } catch (failure) {
            check()
            setError(`Saved ticket retained. Local preparation needs attention: ${(failure as Error).message}`)
          }
        }
      }
      setSelected(record)
      setReport(resumedReport)
      setMiningReady(resumedMining)
      setOfflineReady(resumedOffline)
      setWalletPresent(false)
    })
  }
  function verify() {
    if (!selected?.pkg || !selected.attendeeProof || !miningReady) return
    setReport(undefined)
    void perform(async (signal, check) => {
      const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts')
      check()
      const result = await measured('Ticket verification', () =>
        verifyVenueTicket(selected.pkg!, {
          trustedVenueIdentity: selected.attendeeProof!.venue,
          expectedRequest: selected.attendeeProof!.request,
          online: navigator.onLine,
          signal,
          onProgress: p => {
            check()
            setProgress(p)
          },
        }),
      )
      check()
      setReport(result)
    })
  }
  function mining() {
    if (!selected?.pkg || !selected.attendeeProof) return
    setReport(undefined)
    setOfflineReady(false)
    setMiningReady(false)
    void perform(async (signal, check) => {
      const { fetchStatus } = await import('../settlement/arc.ts'),
        { minedCandidate } = await import('../settlement/evidence.ts')
      check()
      const observed = await fetchStatus(selected.pkg!.current.txid, signal)
      check()
      if (!observed || !['MINED', 'IMMUTABLE'].includes(observed.txStatus)) {
        setNotice(`Mining proof is not available from the provider yet${observed ? ` (${observed.txStatus})` : ''}. Check again later.`)
        return
      }
      const candidate = minedCandidate(
        {
          kind: 'counterfoil-reopening-evidence',
          version: 1,
          trusted: selected.owner,
          buyer: selected.attendeeProof!.request,
          pkg: selected.pkg!,
        },
        observed,
      )
      // Retain the mined envelope before preparation: a temporary header failure
      // must never discard it or require another provider/issuance operation.
      setSelected({ ...selected, pkg: candidate.pkg })
      setMiningReady(true)
      setNotice('Mining evidence loaded for this session. Verify ticket to check it against local headers.')
      if (SHARED_HEADERS_ENABLED && navigator.onLine) {
        const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts')
        check()
        const prepared = await measured('Ticket verification', () =>
          verifyVenueTicket(candidate.pkg!, {
            trustedVenueIdentity: selected.attendeeProof!.venue,
            expectedRequest: selected.attendeeProof!.request,
            online: true,
            signal,
            onProgress: p => {
              check()
              setProgress(p)
            },
          }),
        )
        check()
        setNotice(
          prepared.verdict === 'verified'
            ? 'Mining evidence loaded and verification data is ready on this device. Select Verify ticket for a fresh local result.'
            : 'Mining evidence loaded for this session. Select Verify ticket to review the remaining checks.',
        )
      }
    })
  }
  return (
    <div className="attendee-dashboard">
      <section className="dashboard-welcome" aria-labelledby="dashboard-welcome-title">
        <div className="dashboard-welcome-copy">
          <span className="dashboard-eyebrow">
            <DashboardIcon name="sparkle" /> YOUR TICKETS
          </span>
          <h1 id="dashboard-welcome-title">
            Good times. <em>Great memories.</em>
          </h1>
          <p>A place for your tickets. A little anticipation for what comes next.</p>
          <div className="actions dashboard-welcome-actions">
            <a className="btn primary" href="/events">
              Explore events <DashboardIcon name="arrow" />
            </a>
            <a
              className="btn dashboard-saved-link"
              href="/offline/tickets"
              aria-disabled={busy}
              onClick={event => {
                if (busy) event.preventDefault()
              }}
            >
              <DashboardIcon name="saved" /> Offline tickets
            </a>
          </div>
        </div>
        <div className="dashboard-welcome-art" aria-hidden="true">
          <span className="dashboard-art-orbit" />
          <DashboardIcon name="sparkle" className="dashboard-art-sparkle" />
          <div className="dashboard-art-pass">
            <span>
              TicketSV <DashboardIcon name="ticket" />
            </span>
            <strong>
              Go make
              <br />a memory.
            </strong>
            <div className="dashboard-art-perforation" />
            <small>THE NEXT CHAPTER IS YOURS</small>
            <div className="dashboard-art-bars" />
          </div>
          <span className="dashboard-art-caption">LESS SCROLLING. MORE LIVING.</span>
        </div>
      </section>
      <div className="dashboard-collection-heading">
        <div>
          <h2>
            Your collection <span>{tickets.length + handoffs.length}</span>
          </h2>
          <p>Original deliveries and handoffs, together in one place.</p>
        </div>
        <button
          className="dashboard-refresh"
          aria-label="Refresh dashboard"
          disabled={busy || refreshing === 'explicit'}
          onClick={() => void reload()}
        >
          <DashboardIcon name="refresh" className={refreshing ? 'is-refreshing' : ''} />
          <span>Refresh</span>
        </button>
      </div>
      {loaded && !handoffError && !tickets.length && !handoffs.length && (
        <div className="event-empty dashboard-empty">
          <DashboardIcon name="ticket" />
          <h3>Your first ticket starts with an event.</h3>
          <p>Find something you love. Once the organiser issues your ticket, it appears here.</p>
          <a href="/events">
            Find your next experience <DashboardIcon name="arrow" />
          </a>
        </div>
      )}
      <div className="dashboard-tickets">
        {tickets.map(ticket => (
          <article className="dashboard-ticket" key={ticket.id}>
            <div className="dashboard-ticket-art dashboard-ticket-art-issued">
              <div className="dashboard-ticket-art-top">
                <span className="dashboard-ticket-type">Ticket received</span>
                <DashboardIcon name="ticket" />
              </div>
              <h3>{ticket.event.name}</h3>
              <span className="dashboard-ticket-wordmark">TicketSV / EXPERIENCE SOMETHING</span>
            </div>
            <div className="dashboard-ticket-body">
              <div className="dashboard-ticket-meta">
                <p>
                  <DashboardIcon name="calendar" />
                  {eventDate(ticket.event.date)} · {ticket.event.time}
                </p>
                <p>
                  <DashboardIcon name="pin" />
                  {ticket.event.venue}
                </p>
              </div>
              <p className="dashboard-ticket-note">Delivered to your account. Open your ticket to check its latest evidence.</p>
              <button className="btn dashboard-ticket-open" disabled={busy} onClick={() => open(ticket.id)}>
                View ticket <DashboardIcon name="arrow" />
              </button>
            </div>
          </article>
        ))}
        {handoffs.map(({ ticket, settlement, href }) => (
          <article className="dashboard-ticket" key={`handoff:${ticket.pkg.current.txid}.${ticket.pkg.current.index}`}>
            <div className="dashboard-ticket-art">
              <div className="dashboard-ticket-art-top">
                <span className="dashboard-ticket-type">Received handoff</span>
                <DashboardIcon name="ticket" />
              </div>
              <h3>{ticket.event.name}</h3>
              <span className="dashboard-ticket-wordmark">TicketSV / PASS IT FORWARD</span>
            </div>
            <div className="dashboard-ticket-body">
              <div className="dashboard-ticket-meta">
                <p>
                  <DashboardIcon name="calendar" />
                  {eventDate(ticket.event.date)} · {ticket.event.time}
                </p>
                <p>
                  <DashboardIcon name="pin" />
                  {ticket.event.venue}
                </p>
              </div>
              <div className="dashboard-ticket-status">
                <p className={settlement?.import?.outcome === 'complete' ? 'record-positive' : ''}>
                  Import response:{' '}
                  {settlement?.import?.outcome === 'complete'
                    ? 'accepted'
                    : (settlement?.import?.outcome ?? 'not attempted on this device')}
                </p>
                <p className={settlement?.wallet?.state === 'present' ? 'record-positive' : ''}>
                  Wallet record: {settlement?.wallet?.state ?? 'not checked'}
                </p>
                {settlement?.wallet?.reason.startsWith('Reported on another device: ') && (
                  <small>Historical wallet report. Recheck the receiving wallet for a fresh observation.</small>
                )}
                {settlement?.wallet && <small>Last checked {new Date(settlement.wallet.checkedAt).toLocaleString()}</small>}
              </div>
              <p className="dashboard-ticket-note">Saved on this device for your receiving wallet.</p>
              <a className="btn dashboard-ticket-open" href={href}>
                View received ticket <DashboardIcon name="arrow" />
              </a>
            </div>
          </article>
        ))}
      </div>
      {handoffError && (
        <p className="event-error" role="alert">
          {handoffError}
        </p>
      )}
      {ticketNext !== null && (
        <button className="btn" disabled={busy} onClick={() => more('tickets')}>
          More tickets
        </button>
      )}
      {selected?.pkg && (
        <section className="issuance-review attendee-ticket-flow" aria-label="Selected ticket">
          <div className="event-editor-heading">
            <div>
              <span className="dashboard-eyebrow">YOUR TICKET</span>
              <h2>{selected.event.name}</h2>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setSelected(undefined)
                setReport(undefined)
                setMiningReady(false)
                setOfflineReady(false)
                setWalletPresent(false)
              }}
            >
              Close ticket
            </button>
          </div>
          <p className="attendee-ticket-location">
            {eventDate(selected.event.date)} · {selected.event.time} · {selected.event.venue}
          </p>
          {verified && (
            <TicketQR key={selected.id + selected.pkg.atomicBeefBase64} pkg={selected.pkg} eventName={selected.event.name} busy={busy} />
          )}
          <ol className="attendee-ticket-steps" aria-label="Ticket preparation steps">
            {['Mining evidence', 'Verify ticket', 'Save offline', 'Wallet readiness'].map((label, index) => (
              <li key={label} aria-current={index === ticketStep ? 'step' : undefined} className={index < ticketStep ? 'is-complete' : ''}>
                <span aria-hidden="true">{index < ticketStep ? '✓' : index + 1}</span>
                <div>
                  {label}
                  <small>{index < ticketStep ? 'Complete' : index === ticketStep ? 'Current step' : 'Up next'}</small>
                </div>
              </li>
            ))}
          </ol>
          {!verified && (
            <div className="attendee-current-step">
              <span className="dashboard-eyebrow">STEP {ticketStep + 1} OF 4</span>
              <h3>{miningReady ? 'Verify your ticket.' : 'Check the mining evidence.'}</h3>
              <p>
                {miningReady
                  ? 'Check the organiser, receiving key and mining proof against local headers.'
                  : 'First, check whether your ticket has been mined. If it is still waiting, you can check again later.'}
              </p>
              <div className="actions">
                {!miningReady ? (
                  <button className="btn primary" aria-label="Check mining evidence" disabled={busy} onClick={mining}>
                    Check mining evidence
                  </button>
                ) : (
                  <button className="btn primary" aria-label="Verify ticket" disabled={busy} onClick={verify}>
                    Verify ticket <DashboardIcon name="arrow" />
                  </button>
                )}
              </div>
              {miningReady && (
                <details className="attendee-step-details">
                  <summary>Mining evidence loaded</summary>
                  <button className="btn" disabled={busy} onClick={mining}>
                    Check mining evidence
                  </button>
                </details>
              )}
            </div>
          )}
          {verified && !offlineReady && (
            <div className="attendee-current-step">
              <span className="dashboard-eyebrow">STEP 3 OF 4</span>
              <SaveOfflineTicket
                key={selected.id + selected.pkg.atomicBeefBase64}
                record={selected}
                owner={owner}
                busy={busy}
                perform={perform}
                onProgress={setProgress}
                onReady={() => setOfflineReady(true)}
              />
            </div>
          )}
          {verified && offlineReady && (
            <div className="attendee-current-step">
              <span className="dashboard-eyebrow">{walletPresent ? 'PREPARATION COMPLETE' : 'STEP 4 OF 4'}</span>
              <PrepareTicketWallet
                key={'prepare-' + selected.id + selected.pkg.atomicBeefBase64}
                record={selected}
                owner={owner}
                busy={busy}
                onPresenceChange={setWalletPresent}
                perform={action => perform(action, true)}
                onProgress={setProgress}
              />
            </div>
          )}
          <details className="attendee-step-details">
            <summary>About verification</summary>
            <p>
              {SHARED_HEADERS_ENABLED ? SHARED_HEADER_TRUST : 'Verification downloads missing headers while online.'} Wallet records and
              offline availability are checked separately.
            </p>
          </details>
          <details className="wallet-advanced">
            <summary>Ticket and recipient details</summary>
            <p>
              Ticket ID: <code>{selected.id}</code>
            </p>
            <p>
              Outpoint:{' '}
              <code>
                {selected.pkg.current.txid}.{selected.pkg.current.index}
              </code>
            </p>
            <p>
              Receiving key: <code>{selected.request.recipient.publicKey}</code>
            </p>
          </details>
          {report && (
            <details className="attendee-step-details" open={!verified}>
              <summary>Verification results</summary>
              <div className="issuance-report">
                <h3>Ticket verification: {report.verdict}</h3>
                <ul>
                  {report.checks.map(item => (
                    <li key={item.name}>
                      {item.name}: {item.status} — {item.reason}
                    </li>
                  ))}
                </ul>
                <p>
                  {report.presentedTransferMined
                    ? 'Mining inclusion verified against the saved local snapshot.'
                    : 'Mining inclusion has not been verified.'}
                </p>
                <NetworkLine of={report} />
                <p className="event-help">
                  Local headers retain checkpoint and difficulty-validation limits. This does not establish current unspentness or
                  admission.
                </p>
              </div>
            </details>
          )}
        </section>
      )}
      {requests.length > 0 && (
        <section className="dashboard-requests" aria-labelledby="dashboard-requests-title">
          <div className="dashboard-requests-heading">
            <div>
              <h2 id="dashboard-requests-title">
                Your requests <span aria-hidden="true">{requests.length}</span>
              </h2>
              <p>Track your ticket requests.</p>
            </div>
          </div>
          <div className="dashboard-request-list">
            {requests.map(request => (
              <article className="dashboard-request" key={request.id}>
                <span className="dashboard-request-icon" aria-hidden="true">
                  <DashboardIcon name="ticket" />
                </span>
                <div className="dashboard-request-copy">
                  <h3>{request.event.name}</h3>
                  <p>
                    Requested{' '}
                    <time dateTime={request.createdAt}>
                      {new Date(request.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </time>
                  </p>
                </div>
                <span className={'dashboard-request-status status-' + request.status}>{requestStatus[request.status]}</span>
                {request.status === 'complete' && request.ticketId ? (
                  <button
                    className="btn dashboard-request-action"
                    aria-label="View ticket"
                    disabled={busy}
                    onClick={() => open(request.ticketId!)}
                  >
                    View ticket <DashboardIcon name="arrow" />
                  </button>
                ) : (
                  <a className="btn dashboard-request-action" aria-label="Event details" href={`/events/${request.eventId}`}>
                    Event details <DashboardIcon name="arrow" />
                  </a>
                )}
              </article>
            ))}
          </div>
          {requestNext !== null && (
            <button className="btn dashboard-request-more" disabled={busy} onClick={() => more('requests')}>
              More requests
            </button>
          )}
        </section>
      )}

      {busy && (
        <p role="status">
          {progress ? headerProgressText(progress) : 'Loading or checking your evidence…'}{' '}
          <button
            className="btn"
            onClick={() =>
              active.current?.abort(
                Error(
                  walletOperation.current
                    ? 'Operation cancelled. Cancelling does not undo a wallet action. Review its saved outcome before trying again.'
                    : 'Operation cancelled. No wallet action was made.',
                ),
              )
            }
          >
            Cancel
          </button>
        </p>
      )}
      {notice && (
        <p className="event-saved" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="event-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
