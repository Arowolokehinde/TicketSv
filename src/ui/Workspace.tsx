import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import {TicketSidebar} from './TicketSidebar.tsx'

export type WorkspaceRole = 'holder' | 'venue' | 'scanner'
export const workspaceRoot: Record<WorkspaceRole, string> = {
  holder: '/tickets', venue: '/venue', scanner: '/scanner',
}
const names = { holder: 'Ticket holder', venue: 'Venue', scanner: 'Scanner' }

function DeviceStatus({ root, signedIn }: { root: string; signedIn: boolean }): React.JSX.Element {
  const [online, setOnline] = useState(navigator.onLine)
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
      <summary><span className={`connection-dot ${online ? 'online' : ''}`} />Browser {online ? 'online' : 'offline'}<span>Device details +</span></summary>
      <dl className="device-facts">
        <div><dt>TicketSV account</dt><dd>{signedIn ? 'Signed in · testnet' : 'Not signed in'}</dd></div>
        <div><dt>Headers</dt><dd>Not synced</dd></div>
        <div><dt>Proof size</dt><dd>No package loaded</dd></div>
        <div><dt>Blockchain services</dt><dd>None contacted by the app</dd></div>
      </dl>
      <p>Browser connection status does not establish offline readiness or observe native wallet traffic.</p>
      <a href={`${root}/activity`}>View app activity →</a>
    </details>
  )
}

export function Workspace({ role, title, children }: {
  role: WorkspaceRole; title: string; children: ReactNode
}): React.JSX.Element {
  const { session } = useAuth()
  const root = workspaceRoot[role]
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const dashboard = role === 'holder' && path === root
  const eventManagement = role === 'venue' && path === root
  const sharedSidebar = dashboard || eventManagement
  const links = role === 'holder'
    ? [['Dashboard', root], ['Receive ticket', '/offline/handoff?step=receive'], ['Transfer ticket', '/offline/handoff?step=prepare']]
    : [[role === 'venue' ? 'My events' : 'Scan ticket', root]]
  links.push(['Explore events', '/events'])
  return (
    <div className={`workspace${sharedSidebar ? ' workspace-dashboard' : ''}${eventManagement ? ' event-management' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      
      <div className="shell">
        {sharedSidebar?<TicketSidebar active={eventManagement ? "create-event" : "dashboard"}/>:<nav className="rail" aria-label={`${names[role]} navigation`}>
          <div className="brand">{names[role]}.<span>YOUR WORKSPACE</span></div>
          {links.map(([label, href]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}><span>{label}</span></a>)}
          <div className="rail-note">The proof travels<br />with the ticket.</div>
        </nav>}
        <main className="content" id="main" tabIndex={-1} aria-label={dashboard ? 'Your tickets' : undefined}>
          {!sharedSidebar && <div className="head">
            <div className="grow"><div className="crumb">{eventManagement ? 'Your workspace' : `${names[role]} / This device`}</div><h1>{title}</h1></div>
            <span className="badge b-outline">BSV TESTNET</span>
          </div>}
          {children}
          {!sharedSidebar && <DeviceStatus root={root} signedIn={Boolean(session)} />}
        </main>
      </div>
    </div>
  )
}

export function IntegrationNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="request-notice"><b>Ticket workflow integration coming next.</b><p>{children}</p></div>
}
