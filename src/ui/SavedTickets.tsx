import { OfflineBrowserSupport } from './OfflineBrowserSupport.tsx'
import { ReceivedSync } from './ReceivedSync.tsx'
import { recipientStore, senderStore, sourceKey } from '../handoff/store.ts'
import { settlementKey, settlementStore, type HandoffSettlement } from '../handoff/settlement.ts'
import { senderReleaseStore } from '../handoff/release.ts'
import { fromAttendee } from '../handoff/evidence.ts'
import type { HandoffTicket, RecipientRecord, SenderRecord } from '../handoff/types.ts'
import {
  groupByAccount,
  handoffNextStep,
  needsInternet,
  offlineReadiness,
  readinessText,
  removalPlan,
  statusLabel,
  ticketStatus,
  type TicketStatus,
} from '../offline/home.ts'
import { offlineStorage } from '../offline/persist.ts'
import { clearNetworkActivity, readNetworkActivity, subscribeNetworkActivity } from '../network/recorder.ts'
import { ActivityView } from './OperationPages.tsx'
import { useEffect, useRef, useState } from 'react'
import { listSavedTickets, removeSavedTicket, type SavedTicket } from '../offline/attendee-store.ts'
import { verifyAttendeeEvidence } from '../offline/attendee-evidence.ts'
import { loadSnapshot } from '../headers/store.ts'
import { DashboardIcon } from './DashboardIcon.tsx'
import { TicketQR } from './TicketQR.tsx'
import { eventDate } from './VenueEvents.tsx'
import type { Verification } from '../tickets/types.ts'
import '../styles/offline-tickets.css'
import { measured } from '../network/recorder.ts'
import { NetworkLine } from './NetworkLine.tsx'

const account = (key: string) => (key ? `Account ${key.slice(0, 8)}…${key.slice(-6)}` : 'Unreadable copies')
// Steps that continue on the Confirm tab once the transfer has a settlement record.
const confirmSteps = ['Publish transfer', 'Publication needs review', 'Verify mining', 'Wallet import needs review', 'Add to wallet']
type Progress = { id: string; name: string; role: 'Sending' | 'Receiving'; step: string; href: string }
// Tickets this device still holds; a sent ticket can't be shown at the door or sent again.
const held: TicketStatus[] = ['current', 'received-unmined', 'received', 'in-wallet']

// The offline home. Deliberately outside AuthProvider: everything here is read
// from records saved on this device, with no session, wallet or network call.
export function SavedTickets() {
  const [recipients, setRecipients] = useState<RecipientRecord[]>([]),
    [senders, setSenders] = useState<SenderRecord[]>([]),
    [settlements, setSettlements] = useState<HandoffSettlement[]>([])
  const [storage, setStorage] = useState(''),
    [activity, setActivity] = useState(readNetworkActivity),
    [clearing, setClearing] = useState(false),
    [kept, setKept] = useState<{ id: string; name: string; reason: string }[]>()
  const received = recipients.filter(r => !!r.ticket)
  const [rows, setRows] = useState<SavedTicket[]>([]),
    [selected, setSelected] = useState<SavedTicket>()
  const [report, setReport] = useState<Verification>(),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false),
    [tip, setTip] = useState<number>(),
    [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<string>()
  const active = useRef(false),
    mounted = useRef(true)
  async function refresh() {
    const [saved, rr, ss, tt, kept, snapshot] = await Promise.all([
      listSavedTickets(location.origin),
      recipientStore.list(),
      senderStore.list(),
      settlementStore.list(),
      offlineStorage(),
      loadSnapshot().catch(() => undefined),
    ])
    if (mounted.current) {
      setRows(saved)
      setRecipients(rr)
      setSenders(ss)
      setSettlements(tt)
      setStorage(kept.text)
      setTip(snapshot?.headers.at(-1)?.height)
      setLoaded(true)
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh().catch(e => setError((e as Error).message))
    const unsubscribe = subscribeNetworkActivity(() => setActivity(readNetworkActivity()))
    const connection = () => setOnline(navigator.onLine)
    addEventListener('online', connection)
    addEventListener('offline', connection)
    return () => {
      mounted.current = false
      unsubscribe()
      removeEventListener('online', connection)
      removeEventListener('offline', connection)
    }
  }, [])
  const settlementFor = (ticket: HandoffTicket | undefined) => ticket && settlements.find(s => s.id === settlementKey(ticket))
  function status(ticket: HandoffTicket, received: boolean): TicketStatus {
    const sender = senders.find(s => s.id === sourceKey(ticket))
    return ticketStatus(ticket.pkg, {
      received,
      sender,
      sentSettlement: settlementFor(sender?.transfer),
      settlement: received ? settlementFor(ticket) : undefined,
    })
  }
  // What a held ticket can do offline: a door line, and a transfer line unless a handoff is under way.
  function readiness(ticket: HandoffTicket, received: boolean) {
    if (!held.includes(status(ticket, received))) return undefined
    const sender = senders.find(s => s.id === sourceKey(ticket))
    return { ...offlineReadiness(ticket.pkg, sender, tip), sender }
  }
  function ready(ticket: HandoffTicket, received: boolean) {
    const r = readiness(ticket, received)
    if (!r) return null
    return (
      <>
        <ul className="saved-card-ready" aria-label="Offline readiness">
          <li data-ready={r.door === 'ready'}>{readinessText.door[r.door]}</li>
          {r.transfer !== 'busy' && <li data-ready={r.transfer === 'ready'}>{readinessText.transfer[r.transfer]}</li>}
        </ul>
        {r.transfer === 'ready' && r.sender && (
          <a className="btn saved-card-open" href={`/offline/handoff?source=${encodeURIComponent(r.sender.id)}`}>
            Transfer offline <DashboardIcon name="arrow" />
          </a>
        )}
      </>
    )
  }
  const progress: Progress[] = [
    ...senders.flatMap(sender => {
      const settlement = settlementFor(sender.transfer),
        step = handoffNextStep({ sender, settlement })
      if (!step) return []
      const query =
        settlement && confirmSteps.includes(step)
          ? `transfer=${encodeURIComponent(settlement.id)}`
          : `source=${encodeURIComponent(sender.id)}`
      return [{ id: sender.id, name: sender.ticket.event.name, role: 'Sending' as const, step, href: `/offline/handoff?${query}` }]
    }),
    ...recipients.flatMap(recipient => {
      const settlement = settlementFor(recipient.ticket),
        step = handoffNextStep({ recipient, settlement })
      if (!step) return []
      const query =
        settlement && confirmSteps.includes(step)
          ? `transfer=${encodeURIComponent(settlement.id)}`
          : `request=${encodeURIComponent(recipient.id)}`
      return [
        {
          id: recipient.id,
          name: recipient.request.invitation.event.name,
          role: 'Receiving' as const,
          step,
          href: `/offline/handoff?${query}`,
        },
      ]
    }),
  ]
  const groups = groupByAccount(
    rows,
    received,
    row => row.evidence?.attendee ?? '',
    row => row.request.recipientIdentity,
  )
  async function run(action: () => Promise<void>) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      active.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function checkSaved(row: SavedTicket) {
    // A saved verdict never authorizes presentation. Read current evidence and
    // local headers afresh; no network or wallet request is made here.
    const latest = (await listSavedTickets(location.origin)).find(item => item.id === row.id)
    if (!latest?.evidence) throw Error('This device copy is missing or damaged. Save it again from Dashboard while online.')
    const result = await measured('Saved ticket verification', async () =>
      verifyAttendeeEvidence(latest.evidence, location.origin, await loadSnapshot()),
    )
    if (mounted.current) {
      setSelected(latest)
      setReport(result)
    }
  }
  function open(row: SavedTicket) {
    setSelected(row)
    setReport(undefined)
    setError('')
    void run(() => checkSaved(row))
  }
  function verify() {
    if (!selected?.evidence) return
    setReport(undefined)
    void run(() => checkSaved(selected))
  }

  function remove(row: SavedTicket) {
    void run(async () => {
      await removeSavedTicket(row)
      if (mounted.current) {
        if (selected?.id === row.id) {
          setSelected(undefined)
          setReport(undefined)
        }
        setRemoving(undefined)
      }
      await refresh()
    })
  }
  function removeAll() {
    void run(async () => {
      // Read every record afresh: the plan must see what is saved now, not what this page last listed.
      const [saved, ss, rr, tt, releases] = await Promise.all([
        listSavedTickets(location.origin),
        senderStore.list(),
        recipientStore.list(),
        settlementStore.list(),
        senderReleaseStore.list(),
      ])
      const plan = removalPlan({ saved: saved.map(row => row.id), senders: ss, recipients: rr, settlements: tt, releases })
      for (const row of saved) if (plan.remove.saved.includes(row.id)) await removeSavedTicket(row)
      for (const r of plan.remove.releases) await senderReleaseStore.remove(r.id, r.revision)
      for (const r of plan.remove.settlements) await settlementStore.remove(r.id, r.revision)
      for (const r of plan.remove.senders) await senderStore.remove(r.id, r.revision)
      for (const r of plan.remove.recipients) await recipientStore.remove(r.id, r.revision)
      const names = new Map<string, string>([
        ...ss.map(r => [r.id, r.ticket.event.name] as const),
        ...rr.map(r => [r.id, r.request.invitation.event.name] as const),
        ...tt.map(r => [r.id, r.ticket.event.name] as const),
        ...releases.map(
          r => [r.id, tt.find(t => t.ticket.pkg.current.txid === r.transferTxid)?.ticket.event.name ?? 'Wallet release'] as const,
        ),
      ])
      if (mounted.current) {
        setKept(plan.keep.map(k => ({ ...k, name: names.get(k.id) ?? 'Saved record' })))
        setClearing(false)
        setSelected(undefined)
        setReport(undefined)
      }
      await refresh()
    })
  }
  function card(row: SavedTicket) {
    const door = row.evidence && readiness(fromAttendee(row.evidence), false)?.door === 'ready'
    return (
      <article className={`offline-ticket-card saved-library-card${row.error ? ' saved-library-card-damaged' : ''}`} key={row.id}>
        <div className="saved-card-face">
          <div className="saved-card-face-top">
            <span className="saved-card-label">{row.error ? 'Needs attention' : 'Device copy'}</span>
            <DashboardIcon name="ticket" />
          </div>
          <h2>{row.evidence?.event.name ?? 'Unreadable ticket'}</h2>
          <small>TicketSV / SAVED WITH YOU</small>
        </div>
        <div className="saved-card-body">
          {row.evidence && (
            <>
              <p className="saved-card-status" data-status={status(fromAttendee(row.evidence), false)}>
                {statusLabel[status(fromAttendee(row.evidence), false)]}
              </p>
              <div className="saved-card-meta">
                <p>
                  <DashboardIcon name="calendar" />
                  {eventDate(row.evidence.event.date)} · {row.evidence.event.time}
                </p>
                <p>
                  <DashboardIcon name="pin" />
                  {row.evidence.event.venue}
                </p>
              </div>
              {ready(fromAttendee(row.evidence), false)}
              <p className="saved-card-note">Saved {new Date(row.evidence.savedAt).toLocaleString()}</p>
              <details className="saved-card-account">
                <summary>Saved account</summary>
                <code>{row.evidence.attendee}</code>
              </details>
            </>
          )}
          {row.error && (
            <p className="saved-card-error" role="alert">
              {row.error}
            </p>
          )}
          <div className="actions saved-card-actions">
            {row.evidence && (
              <button className="btn primary" aria-label={door ? 'Show door QR' : 'Open ticket'} disabled={busy} onClick={() => open(row)}>
                {door ? 'Show door QR' : 'Open ticket'} <DashboardIcon name="arrow" />
              </button>
            )}
            <button className="saved-card-remove" disabled={busy} onClick={() => setRemoving(row.id)}>
              Remove from this device
            </button>
          </div>
          {removing === row.id && (
            <div className="offline-remove">
              <p>Remove only this device copy? Your account and wallet records stay unchanged.</p>
              <button className="btn" disabled={busy} onClick={() => remove(row)}>
                Confirm removal
              </button>
              <button className="btn" disabled={busy} onClick={() => setRemoving(undefined)}>
                Keep ticket
              </button>
            </div>
          )}
        </div>
      </article>
    )
  }
  function receivedCard(row: RecipientRecord) {
    return (
      <article className="offline-ticket-card saved-library-card" key={row.id}>
        <div className="saved-card-face saved-card-face-handoff">
          <div className="saved-card-face-top">
            <span className="saved-card-label">Received handoff</span>
            <DashboardIcon name="ticket" />
          </div>
          <h2>{row.ticket!.event.name}</h2>
          <small>TicketSV / PASS IT FORWARD</small>
        </div>
        <div className="saved-card-body">
          <p className="saved-card-status" data-status={status(row.ticket!, true)}>
            {statusLabel[status(row.ticket!, true)]}
          </p>
          <div className="saved-card-meta">
            <p>
              <DashboardIcon name="calendar" />
              {eventDate(row.ticket!.event.date)} · {row.ticket!.event.time}
            </p>
            <p>
              <DashboardIcon name="pin" />
              {row.ticket!.event.venue}
            </p>
          </div>
          <p className="saved-card-evidence">
            <DashboardIcon name="saved" /> Saved on this device
          </p>
          {ready(row.ticket!, true)}
          <p className="saved-card-note">Saved evidence. Verify again for its current local result.</p>
          <a className="btn primary saved-card-open" href={`/offline/handoff?request=${encodeURIComponent(row.id)}`}>
            Open received ticket <DashboardIcon name="arrow" />
          </a>
        </div>
      </article>
    )
  }
  return (
    <div className="offline-library saved-library">
      <main id="main" className="offline-content">
        <div className="handoff-page-heading saved-library-heading">
          <div>
            <span className="handoff-eyebrow">
              <DashboardIcon name="saved" />
              SAVED ON THIS DEVICE
            </span>
            <h1>Offline tickets.</h1>
            <p>Opens without internet or sign-in. Each ticket shows what it can do offline.</p>
          </div>
          <div className="handoff-heading-symbol" aria-hidden="true">
            <DashboardIcon name="ticket" />
          </div>
        </div>
        <ReceivedSync onRestored={refresh} />
        <div className="saved-library-collection">
          <div>
            <h2>
              On this device <span>{rows.length + received.length}</span>
            </h2>
            <p>Open a ticket to check its saved evidence.</p>
            {storage && <p className="saved-library-storage">{storage}</p>}
          </div>
          <span className="saved-library-local">
            <DashboardIcon name="saved" /> Device copies
          </span>
        </div>
        {kept && (
          <section className="saved-library-kept" aria-label="Kept on this device">
            {kept.length ? (
              <>
                <h2>Kept on this device</h2>
                <ul>
                  {kept.map(item => (
                    <li key={item.id}>
                      <strong>{item.name}</strong> · {item.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p role="status">Everything was removed from this device.</p>
            )}
          </section>
        )}
        {progress.length > 0 && (
          <section className="saved-library-progress" aria-label="Handoffs in progress">
            <h2>Handoffs in progress</h2>
            <ul>
              {progress.map(item => (
                <li key={`${item.role}:${item.id}`}>
                  <span>
                    {item.role} · <strong>{item.name}</strong>
                  </span>
                  <span className="saved-library-step">
                    {!online && needsInternet(item.step) && <span className="saved-library-tag">Needs internet</span>}
                    <a href={item.href}>
                      {item.step} <DashboardIcon name="arrow" />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {loaded && !rows.length && !received.length && (
          <div className="event-empty saved-library-empty">
            <DashboardIcon name="ticket" />
            <h2>No tickets saved on this device.</h2>
            <p>While online, open a ticket in Dashboard and select Save for offline use.</p>
            <a className="btn primary" href="/tickets">
              Open Dashboard <DashboardIcon name="arrow" />
            </a>
          </div>
        )}
        {[...groups].map(([key, items]) => (
          <section className="saved-library-account" aria-label={account(key)} key={key}>
            <h2>{account(key)}</h2>
            <div className="offline-ticket-grid saved-library-grid">
              {items.saved.map(card)}
              {items.received.map(receivedCard)}
            </div>
          </section>
        ))}
        {selected?.evidence && (
          <section className="issuance-review" aria-label="Saved ticket details">
            <div className="event-editor-heading">
              <h2>{selected.evidence.event.name}</h2>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  setSelected(undefined)
                  setReport(undefined)
                }}
              >
                Close ticket
              </button>
            </div>
            <p>Evidence checked against the headers saved on this device.</p>
            <button className="btn primary" aria-label="Verify locally" disabled={busy} onClick={verify}>
              Verify locally
            </button>
            {report?.verdict === 'verified' && report.presentedTransferMined && held.includes(status(fromAttendee(selected.evidence), false)) && (
              <TicketQR
                key={selected.id + selected.evidence.pkg.atomicBeefBase64}
                pkg={selected.evidence.pkg}
                eventName={selected.evidence.event.name}
                busy={busy}
              />
            )}
            {report && (
              <div className="issuance-report" aria-live="polite">
                <h3>Saved ticket verification: {report.verdict}</h3>
                <ul>
                  {report.checks.map(check => (
                    <li key={check.name}>
                      {check.name}: {check.status} — {check.reason}
                    </li>
                  ))}
                </ul>
                <p>
                  {report.presentedTransferMined
                    ? 'Mining inclusion verified against saved local headers.'
                    : 'Mining inclusion is not verified in this result.'}
                </p>
                <NetworkLine of={report} />
                {report.verdict === 'incomplete' && (
                  <p>Return to Dashboard while online and save this ticket again to prepare missing evidence.</p>
                )}
              </div>
            )}
            <details className="wallet-advanced">
              <summary>Ticket details and verification limits</summary>
              <p>
                Account: <code>{selected.evidence.attendee}</code>
              </p>
              <p>
                Ticket: <code>{selected.evidence.id}</code>
              </p>
              <p>
                Outpoint:{' '}
                <code>
                  {selected.evidence.pkg.current.txid}.{selected.evidence.pkg.current.index}
                </code>
              </p>
              <p>
                Venue: <code>{selected.evidence.trustedVenue}</code>
              </p>
              <p>
                Event details are the saved review snapshot. The venue signature binds the event ID, ticket ID and original output. Header
                checks retain checkpoint and difficulty-validation limits; mining inclusion does not establish current unspentness or
                admission.
              </p>
            </details>
            <p className="event-help">
              Open Send / Receive to prepare transfer fees and hand off your ticket. Saving evidence alone does not prepare your wallet for
              signing.
            </p>
          </section>
        )}
        <OfflineBrowserSupport />
        <details className="wallet-advanced saved-library-activity">
          <summary>Activity on this device</summary>
          <ActivityView activity={activity} onClear={clearNetworkActivity} />
        </details>
        {loaded && (rows.length > 0 || recipients.length > 0 || senders.length > 0 || settlements.length > 0) && (
          <div className="saved-library-clear">
            {clearing ? (
              <div className="offline-remove">
                <p>
                  Remove saved tickets and handoff records from this device? Anything with an unfinished or unknown wallet, signing or
                  publishing step is kept. Your account and wallet are unchanged.
                </p>
                <button className="btn" disabled={busy} onClick={removeAll}>
                  Remove all
                </button>
                <button className="btn" disabled={busy} onClick={() => setClearing(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="saved-card-remove" disabled={busy} onClick={() => setClearing(true)}>
                Remove all from this device
              </button>
            )}
          </div>
        )}
        {busy && <p role="status">Checking local evidence…</p>}
        {error && (
          <p className="event-error" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
