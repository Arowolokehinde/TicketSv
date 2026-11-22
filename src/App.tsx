import { ScannerAccess } from './ui/ScannerAccess.tsx'
import { scannerOfflineSession } from './scanner/authorization.ts'
import { offlineDestination } from './navigation/offline.ts'
import { useAppLocation } from './navigation/location.ts'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { movedRoute } from './navigation/moved.ts'
import { LandingPage } from './ui/LandingPage.tsx'
import { Workspace, type WorkspaceRole } from './ui/Workspace.tsx'
import { ActivityPage, HeadersPage } from './ui/OperationPages.tsx'
import { ScannerPage } from './ui/ScannerPage.tsx'
import './styles/scanner.css'
import { EventsPage, EventPage } from './ui/Marketplace.tsx'
import { OfflineHandoff } from './ui/OfflineHandoff.tsx'
import { SavedTickets } from './ui/SavedTickets.tsx'
import { AttendeeDashboard } from './ui/AttendeeDashboard.tsx'
import { CreateEvent } from './ui/VenueEvents.tsx'
import { MyEvents } from './ui/MyEvents.tsx'
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

// Development screens exist only in dev or when built with VITE_DEV_ROUTES=true;
// production builds leave their code out entirely.
declare const __TICKETSV_DEV_ROUTES__: boolean
const devScreens =
  typeof __TICKETSV_DEV_ROUTES__ === 'boolean' && __TICKETSV_DEV_ROUTES__
    ? {
        '/dev/reopening': lazy(() => import('./dev/ReopeningScreen.tsx').then(m => ({ default: m.ReopeningScreen }))),
        '/dev/feasibility': lazy(() => import('./dev/FeasibilityScreen.tsx').then(m => ({ default: m.FeasibilityScreen }))),
      }
    : undefined

// Ordinary links support direct URLs, refresh and browser back.
// Static hosting must serve index.html for product paths (Vite does this).
export default function App(): React.JSX.Element {
  const address = useAppLocation()
  const path = offlineDestination(address, navigator.onLine).split('?')[0].replace(/\/+$/, '') || '/'
  const routes: Record<string, Route> = {
    '/tickets': { role: 'holder', title: 'Dashboard.', page: <AttendeeDashboard /> },
    '/venue': { role: 'venue', title: 'Create event.', page: <CreateEvent /> },
    '/venue/my-events': { role: 'venue', title: 'My events.', page: <MyEvents /> },
    '/scanner': { role: 'scanner', title: 'Scan a ticket.', page: <ScannerPage /> },
  }
  for (const [root, role] of [
    ['/tickets', 'holder'],
    ['/venue', 'venue'],
    ['/scanner', 'scanner'],
  ] as const) {
    routes[`${root}/headers`] = { role, title: 'Block headers.', page: <HeadersPage /> }
    routes[`${root}/activity`] = { role, title: 'App activity.', page: <ActivityPage /> }
  }
  const route = routes[path],
    moved = movedRoute(path)
  const DevScreen = devScreens?.[path as keyof typeof devScreens]
  useEffect(() => {
    document.title = `${path === '/' ? 'Your ticket. Ready to change hands.' : (route?.title ?? (path === '/offline/handoff' ? 'Ticket handoff' : path === '/offline/tickets' ? 'Offline tickets' : path.startsWith('/events') ? 'Events' : path === '/dev/feasibility' ? 'Development harness' : path === '/dev/reopening' ? 'Offline reopening experiment' : 'Page not found'))} — TicketSV`
  }, [path, route?.title])
  useEffect(() => {
    if (moved) location.replace(moved)
  }, [moved])

  if (moved)
    return (
      <>
        <AppHeader />
        <p role="status">Opening the new page…</p>
      </>
    )

  if (path === '/events' || /^\/events\/[a-f0-9-]+$/.test(path))
    return (
      <AuthProvider>
        <AppHeader />
        {path === '/events' ? <EventsPage key={address} /> : <EventPage key={address} id={path.split('/')[2]} />}
        <WalletLoginDialog />
      </AuthProvider>
    )
  if (path === '/')
    return (
      <AuthProvider>
        <AppHeader />
        <LandingPage />
        <WalletLoginDialog />
      </AuthProvider>
    )
  if (path === '/offline/handoff')
    return (
      <>
        <AppHeader />
        <OfflineHandoff key={address} />
      </>
    )
  if (path === '/offline/tickets')
    return (
      <>
        <AppHeader />
        <SavedTickets />
      </>
    )
  if (path === '/scanner' || path === '/scanner/prepare')
    return (
      <AuthProvider offlineSession={scannerOfflineSession}>
        <AppHeader />
        <ScannerAccess>
          <ScannerPage />
        </ScannerAccess>
        <WalletLoginDialog />
      </AuthProvider>
    )
  if (DevScreen)
    return (
      <>
        <AppHeader />
        <Suspense fallback={<p role="status">Loading development screen…</p>}>
          <DevScreen />
        </Suspense>
      </>
    )
  if (route) {
    const workspace = (
      <Workspace key={address} role={route.role} title={route.title}>
        {route.page}
      </Workspace>
    )
    return (
      <AuthProvider>
        <AppHeader />
        <RequireAuth>{workspace}</RequireAuth>
        <WalletLoginDialog />
      </AuthProvider>
    )
  }
  return (
    <>
      <AppHeader />
      <main id="main" className="development-page">
        <a className="wordmark" href="/">
          TicketSV
        </a>
        <h1>Page not found.</h1>
        <p>This address does not match a TicketSV page.</p>
        <a className="btn primary" href="/">
          Back to home
        </a>
      </main>
    </>
  )
}
