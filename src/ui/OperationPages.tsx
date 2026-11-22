import { useEffect, useState } from 'react'
import { loadSnapshot } from '../headers/store.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { clearNetworkActivity, readNetworkActivity, subscribeNetworkActivity, type NetworkActivity } from '../network/recorder.ts'
import { outcomeText } from './NetworkLine.tsx'

export function headerSummary(snapshot: HeaderSnapshot | undefined): { range: string; saved: string; source: string } | undefined {
  const first = snapshot?.headers[0]?.height,
    last = snapshot?.headers.at(-1)?.height
  if (!snapshot || first === undefined || last === undefined) return undefined
  return {
    range: `${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} (${snapshot.headers.length.toLocaleString('en-US')} headers)`,
    saved: new Date(snapshot.syncedAt).toLocaleString(),
    source:
      snapshot.source === 'ticketsv-cache'
        ? 'TicketSV shared cache, checked on this device'
        : 'WhatsOnChain and Chaintracks, compared on this device',
  }
}

export function HeadersPage(): React.JSX.Element {
  const [summary, setSummary] = useState<ReturnType<typeof headerSummary> | null>(null)
  useEffect(() => {
    let current = true
    void loadSnapshot().then(
      value => {
        if (current) setSummary(headerSummary(value))
      },
      () => {
        if (current) setSummary(undefined)
      },
    )
    return () => {
      current = false
    }
  }, [])
  return (
    <section className="request-start">
      <span className="home-eyebrow">THE LOCAL CHAIN VIEW</span>
      <h2>
        Small headers.
        <br />
        <em>Independent checks.</em>
      </h2>
      <p>
        Block headers give the local verifier a Merkle root to check each mined transaction against. Headers are downloaded while online
        when a ticket check needs them, then reused offline.
      </p>
      {summary === null ? (
        <p role="status">Reading saved headers…</p>
      ) : summary ? (
        <dl className="kv">
          <dt>Saved range</dt>
          <dd>{summary.range}</dd>
          <dt>Last saved</dt>
          <dd>{summary.saved}</dd>
          <dt>Source</dt>
          <dd>{summary.source}</dd>
        </dl>
      ) : (
        <p>No headers are saved on this device yet. Verify a ticket while online to prepare them.</p>
      )}
      <p className="boundary">
        This device validates proof of work and header linkage from a pinned checkpoint. Full difficulty-adjustment validation is outside
        this POC.
      </p>
    </section>
  )
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export function ActivityView({ activity, onClear }: { activity: NetworkActivity; onClear: () => void }): React.JSX.Element {
  const checks = [...activity.checks].reverse(),
    requests = [...activity.requests].reverse()
  return (
    <>
      <h3>Verification checks</h3>
      {checks.length ? (
        <ul className="activity-list">
          {checks.map(check => (
            <li key={`${check.startedAt}-${check.label}`}>
              <time>{clock(check.startedAt)}</time> {check.label} · {check.verdict ?? 'no verdict'} ·{' '}
              {check.measured
                ? `${check.requestCount} network request${check.requestCount === 1 ? '' : 's'}${check.otherLoads ? ` · ${check.otherLoads} other browser loads` : ''}`
                : 'network not measured'}
            </li>
          ))}
        </ul>
      ) : (
        <p>No checks recorded on this device.</p>
      )}
      <h3>Network requests</h3>
      {requests.length ? (
        <ul className="activity-list">
          {requests.map((request, index) => (
            <li key={`${request.at}-${index}`}>
              <time>{clock(request.at)}</time> {request.method} {request.purpose} · <code>{request.path}</code> · {outcomeText(request)}
              {request.ms === undefined ? '' : ` · ${request.ms} ms`}
            </li>
          ))}
        </ul>
      ) : (
        <p>No network requests recorded on this device.</p>
      )}
      <button className="btn" disabled={!checks.length && !requests.length} onClick={onClear}>
        Clear activity
      </button>
      <p className="limits">
        Not visible to this app: traffic inside the BSV Browser wallet, BSV Desktop&apos;s own internet traffic, and files the offline app
        cache downloads. Files the browser loads outside fetch, such as images and scripts, are counted only as other browser loads during a
        check.
      </p>
    </>
  )
}

export function ActivityPage(): React.JSX.Element {
  const [activity, setActivity] = useState(readNetworkActivity)
  useEffect(() => subscribeNetworkActivity(() => setActivity(readNetworkActivity())), [])
  return (
    <section className="request-start">
      <span className="home-eyebrow">APP-OBSERVED ACTIVITY</span>
      <h2>
        The checks.
        <br />
        <em>In the open.</em>
      </h2>
      <p>
        Every request this page sends with fetch is recorded here, newest first, with each verification check and the requests made during
        it. The last 200 requests and 50 checks are kept in this browser only. Query strings and request contents are never recorded.
      </p>
      <ActivityView activity={activity} onClear={clearNetworkActivity} />
    </section>
  )
}
