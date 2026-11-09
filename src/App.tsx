import {ScannerAccess} from './ui/ScannerAccess.tsx'
import {scannerOfflineSession} from './scanner/authorization.ts'
import {useAppLocation} from './navigation/location.ts'
import { useEffect, type ReactNode } from 'react'
import { ReopeningScreen } from './dev/ReopeningScreen.tsx'
import { FeasibilityScreen } from './dev/FeasibilityScreen.tsx'
import { LandingPage } from './ui/LandingPage.tsx'
import { Workspace, type WorkspaceRole } from './ui/Workspace.tsx'
import { ReceivePage, SampleTicketPage, TransferPage } from './ui/TicketPages.tsx'
import { ActivityPage, HeadersPage, PreparationPage } from './ui/OperationPages.tsx'
import {ScannerPage} from './ui/ScannerPage.tsx'
import './styles/scanner.css'
import { EventsPage, EventPage } from './ui/Marketplace.tsx'
import { OfflineHandoff } from './ui/OfflineHandoff.tsx'
import { SavedTickets } from './ui/SavedTickets.tsx'
import { AttendeeDashboard } from './ui/AttendeeDashboard.tsx'
import { VenueEvents } from './ui/VenueEvents.tsx'
import { AuthProvider, RequireAuth } from './auth/AuthProvider.tsx'
import { WalletLoginDialog } from './ui/WorkspaceWallet.tsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/approved.css'
import './styles/website.css'
import './styles/dashboard.css'
import './styles/saved-tickets.css'
import './styles/handoff-modern.css'
import './styles/events-modern.css'
import { AppHeader } from './ui/AppHeader.tsx'
import './styles/app-header.css'
import './styles/event-management.css'

type Route = { role: WorkspaceRole; title: string; page: ReactNode }

// Ordinary links support direct URLs, refresh and browser back.
// Static hosting must serve index.html for product paths (Vite does this).
export default function App(): React.JSX.Element {
  const address=useAppLocation()
  const path = address.split('?')[0].replace(/\/+$/, '') || '/'
  const routes: Record<string, Route> = {
    '/tickets': { role: 'holder', title: 'Dashboard.', page: <AttendeeDashboard /> },
    '/tickets/receive': { role: 'holder', title: 'Receive a ticket.', page: <ReceivePage /> },
    '/tickets/transfer': { role: 'holder', title: 'Transfer a ticket.', page: <TransferPage /> },
    '/tickets/sample': { role: 'holder', title: 'Harbour Nights.', page: <SampleTicketPage /> },
    '/venue': { role: 'venue', title: 'Create event.', page: <VenueEvents /> },
    '/scanner': { role: 'scanner', title: 'Scan a ticket.', page: <ScannerPage /> },
  }
  for (const [root, role] of [['/tickets', 'holder'], ['/venue', 'venue'], ['/scanner', 'scanner']] as const) {
    routes[`${root}/prepare`] = { role, title: 'Prepare for offline use.', page: <PreparationPage role={role} /> }
    routes[`${root}/headers`] = { role, title: 'Block headers.', page: <HeadersPage /> }
    routes[`${root}/activity`] = { role, title: 'App activity.', page: <ActivityPage /> }
  }
  const route = routes[path]
  useEffect(() => {
    document.title = `${path === '/' ? 'Your ticket. Ready to change hands.' : route?.title ?? (path === '/offline/handoff' ? 'Ticket handoff' : path === '/offline/tickets' ? 'Saved tickets' : path.startsWith('/events') ? 'Events' : path === '/dev/feasibility' ? 'Development harness' : path === '/dev/reopening' ? 'Offline reopening experiment' : 'Page not found')} — TicketSV`
  }, [path, route?.title])

  if (path === '/events' || /^\/events\/[a-f0-9-]+$/.test(path)) return <AuthProvider><AppHeader />{path === '/events' ? <EventsPage key={address} /> : <EventPage key={address} id={path.split('/')[2]} />}<WalletLoginDialog /></AuthProvider>
  if (path === '/') return <AuthProvider><AppHeader /><LandingPage /><WalletLoginDialog /></AuthProvider>
  if (path === '/offline/handoff') return <><AppHeader /><OfflineHandoff /></>
  if (path === '/offline/tickets') return <><AppHeader /><SavedTickets /></>
  if (path === '/scanner' || path === '/scanner/prepare') return <AuthProvider offlineSession={scannerOfflineSession}><AppHeader /><ScannerAccess><ScannerPage/></ScannerAccess><WalletLoginDialog/></AuthProvider>
  if (path === '/dev/reopening') return <><AppHeader /><ReopeningScreen /></>
  if (path === '/dev/feasibility') return <><AppHeader /><FeasibilityScreen /></>
  if (route) {
    const workspace = <Workspace key={address} role={route.role} title={route.title}>{route.page}</Workspace>
    return <AuthProvider><AppHeader /><RequireAuth>{workspace}</RequireAuth><WalletLoginDialog /></AuthProvider>
  }
  return <><AppHeader /><main className="development-page">
    <a className="wordmark" href="/">TicketSV</a>
    <h1>Page not found.</h1>
    <p>This address does not match a TicketSV page.</p>
    <a className="btn primary" href="/">Back to home</a>
  </main></>
}
