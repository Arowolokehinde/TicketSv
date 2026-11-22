import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { TicketSidebar } from './TicketSidebar.tsx'
import { loadSnapshot } from '../headers/store.ts'
import { readNetworkActivity, subscribeNetworkActivity } from '../network/recorder.ts'
import { outcomeText } from './NetworkLine.tsx'
import { waitingRequests } from '../events/api.ts'

// My events reports the count it loads, so the sidebar doesn't ask again.
export const WAITING_EVENT = 'ticketsv-waiting-requests'

export type WorkspaceRole = 'holder' | 'venue' | 'scanner'
export const workspaceRoot: Record<WorkspaceRole, string> = {
  holder: '/tickets',
  venue: '/venue',
  scanner: '/scanner',
}
const names = { holder: 'Ticket holder', venue: 'Venue', scanner: 'Scanner' }

export function DeviceStatus({ root, signedIn }: { root: string; signedIn: boolean }): React.JSX.Element {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [headers, setHeaders] = useState<string>('Reading saved headers…')
  const [last, setLast] = useState(() => readNetworkActivity().requests.at(-1))
  useEffect(() => subscribeNetworkActivity(() => setLast(readNetworkActivity().requests.at(-1))), [])
  useEffect(() => {
    let current = true
    void loadSnapshot().then(
      value => {
        const top = value?.headers.at(-1)
        if (current)
          setHeaders(
            top
              ? `Saved to block ${top.height.toLocaleString('en-US')} · ${new Date(value!.syncedAt).toLocaleString()}`
              : 'None saved on this device',
          )
      },
      () => {
        if (current) setHeaders('Saved headers could not be read')
      },
    )
    return () => {
      current = false
    }
  }, [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return (
    <details className="device-status">
      <summary>
        <span className={`connection-dot ${online ? 'online' : ''}`} />
        Browser {online ? 'online' : 'offline'}
        <span>Device details +</span>
      </summary>
      <dl className="device-facts">
        <div>
          <dt>TicketSV account</dt>
          <dd>{signedIn ? 'Signed in · testnet' : 'Not signed in'}</dd>
        </div>
        <div>
          <dt>Headers</dt>
          <dd>{headers}</dd>
        </div>
        <div>
          <dt>Network activity</dt>
          <dd>
            {last
              ? `Last request ${new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${last.purpose} (${outcomeText(last)})`
              : 'None recorded on this device'}
          </dd>
        </div>
      </dl>
      <p>Browser connection status does not establish offline readiness or observe native wallet traffic.</p>
      <a href={`${root}/activity`}>View app activity →</a>
    </details>
  )
}

export function Workspace({ role, title, children }: { role: WorkspaceRole; title: string; children: ReactNode }): React.JSX.Element {
  const { session } = useAuth()
  const root = workspaceRoot[role]
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const dashboard = role === 'holder' && path === root
  const myEvents = role === 'venue' && path === '/venue/my-events'
  const eventManagement = role === 'venue' && (path === root || myEvents)
  const sharedSidebar = dashboard || eventManagement
  const [waiting, setWaiting] = useState<number>(),
    identity = session?.identityKey
  useEffect(() => {
    if (!sharedSidebar || !identity) return
    let current = true
    const reported = (event: Event) => setWaiting((event as CustomEvent<number>).detail)
    window.addEventListener(WAITING_EVENT, reported)
    if (!myEvents && navigator.onLine)
      void waitingRequests(0).then(
        result => {
          if (current) setWaiting(result.total)
        },
        () => {},
      )
    return () => {
      current = false
      window.removeEventListener(WAITING_EVENT, reported)
    }
  }, [sharedSidebar, myEvents, identity])
  const links =
    role === 'holder'
      ? [
          ['Dashboard', root],
          ['Receive ticket', '/offline/handoff?step=receive'],
          ['Transfer ticket', '/offline/handoff?step=prepare'],
        ]
      : role === 'venue'
        ? [
            ['Create event', root],
            ['My events', '/venue/my-events'],
          ]
        : [['Scan ticket', root]]
  links.push(['Explore events', '/events'])
  return (
    <div className={`workspace${sharedSidebar ? ' workspace-dashboard' : ''}${eventManagement ? ' event-management' : ''}`}>
      <div className="shell">
        {sharedSidebar ? (
          <TicketSidebar active={myEvents ? 'my-events' : eventManagement ? 'create-event' : 'dashboard'} waiting={waiting} />
        ) : (
          <nav className="rail" aria-label={`${names[role]} navigation`}>
            <div className="brand">
              {names[role]}.<span>YOUR WORKSPACE</span>
            </div>
            {links.map(([label, href]) => (
              <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>
                <span>{label}</span>
              </a>
            ))}
            <div className="rail-note">
              The proof travels
              <br />
              with the ticket.
            </div>
          </nav>
        )}
        <main className="content" id="main" tabIndex={-1} aria-label={dashboard ? 'Your tickets' : undefined}>
          {!sharedSidebar && (
            <div className="head">
              <div className="grow">
                <div className="crumb">{eventManagement ? 'Your workspace' : `${names[role]} / This device`}</div>
                <h1>{title}</h1>
              </div>
              <span className="badge b-outline">BSV TESTNET</span>
            </div>
          )}
          {children}
          {!sharedSidebar && <DeviceStatus root={root} signedIn={Boolean(session)} />}
        </main>
      </div>
    </div>
  )
}
