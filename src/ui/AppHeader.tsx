import { useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth, useOptionalAuth } from '../auth/AuthProvider.tsx'
import { WalletLoginDialog } from './WorkspaceWallet.tsx'

// Offline pages mount authentication only after an explicit Account click.
function OfflineAccountPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const auth = useAuth()
  const opened = useRef(false)
  useEffect(() => {
    if (auth.loading) return
    if (!opened.current) { opened.current = true; auth.open(); return }
    if (auth.destination === null) onClose()
  }, [auth.loading, auth.destination, auth.open, onClose])
  return <WalletLoginDialog />
}

export function AppHeader(): React.JSX.Element {
  const auth = useOptionalAuth()
  const [accountOpen, setAccountOpen] = useState(false)
  const path = window.location.pathname
  const active = path.startsWith('/scanner') ? '/scanner' : path.startsWith('/events') ? '/events' : path.startsWith('/venue') ? '/tickets' : path.startsWith('/tickets') || path.startsWith('/offline') ? '/tickets' : ''
  return <>
    <header className="app-header">
      <a href="/" className="app-wordmark" aria-label="TicketSV home">TicketSV</a>
      <nav aria-label="Primary navigation">
        {[['Events', '/events'], ['Dashboard', '/tickets'], ['Scanner', '/scanner']].map(([label, href]) =>
          <a key={href} href={href} aria-current={active === href ? 'page' : undefined} onClick={event => {
            if ((href === '/tickets'||href==='/scanner') && auth && !auth.session) { event.preventDefault(); auth.open(href) }
          }}>{label}</a>)}
      </nav>
      <button className="app-account" disabled={auth?.loading} onClick={() => auth ? auth.open() : setAccountOpen(true)}>Account<span aria-hidden="true">↗</span></button>
    </header>
    {!auth && accountOpen && <AuthProvider><OfflineAccountPanel onClose={() => setAccountOpen(false)} /></AuthProvider>}
  </>
}
