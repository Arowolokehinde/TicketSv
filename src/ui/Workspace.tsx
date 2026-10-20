import { useEffect, useState, type ReactNode } from 'react'

export type WorkspaceRole = 'holder' | 'venue' | 'scanner'
export const workspaceRoot: Record<WorkspaceRole, string> = {
  holder: '/tickets', venue: '/venue', scanner: '/scanner',
}
const names = { holder: 'Ticket holder', venue: 'Venue', scanner: 'Scanner' }

function DeviceStatus({ root }: { root: string }): React.JSX.Element {
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
        <div><dt>Wallet</dt><dd>Not connected</dd></div>
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
  const root = workspaceRoot[role]
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const links = role === 'holder'
    ? [['My tickets', root], ['Receive ticket', `${root}/receive`], ['Transfer ticket', `${root}/transfer`]]
    : [[role === 'venue' ? 'Issue ticket' : 'Scan ticket', root]]
  links.push(['Prepare offline', `${root}/prepare`], ['Headers', `${root}/headers`], ['App activity', `${root}/activity`])
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="landing-wordmark" href="/">Counterfoil<span>®</span></a>
        <span className="site-context">{names[role]} / BSV testnet</span>
        <a className="workspace-exit" href="/">← Home</a>
      </header>
      <div className="shell">
        <nav className="rail" aria-label={`${names[role]} navigation`}>
          <div className="brand">{names[role]}.<span>YOUR WORKSPACE</span></div>
          {links.map(([label, href]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>)}
          <div className="rail-note">The proof travels<br />with the ticket.</div>
        </nav>
        <main className="content" id="main" tabIndex={-1}>
          <div className="head">
            <div className="grow"><div className="crumb">{names[role]} / This device</div><h1>{title}</h1></div>
            <span className="badge b-outline">BSV TESTNET</span>
          </div>
          {children}
          <DeviceStatus root={root} />
        </main>
      </div>
    </div>
  )
}

export function IntegrationNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="request-notice"><b>Wallet & verification integration coming next.</b><p>{children}</p></div>
}
