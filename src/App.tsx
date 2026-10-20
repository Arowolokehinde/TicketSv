import { useEffect, type ReactNode } from 'react'
import { FeasibilityScreen } from './dev/FeasibilityScreen.tsx'
import { LandingPage } from './ui/LandingPage.tsx'
import { Workspace, type WorkspaceRole } from './ui/Workspace.tsx'
import { CollectionPage, ReceivePage, SampleTicketPage, TransferPage } from './ui/TicketPages.tsx'
import { ActivityPage, HeadersPage, PreparationPage, ScannerPage, VenuePage } from './ui/OperationPages.tsx'
import './styles/tokens.css'
import './styles/base.css'
import './styles/approved.css'
import './styles/website.css'

type Route = { role: WorkspaceRole; title: string; page: ReactNode }

// Ordinary links support direct URLs, refresh and browser back.
// Static hosting must serve index.html for product paths (Vite does this).
export default function App(): React.JSX.Element {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const routes: Record<string, Route> = {
    '/tickets': { role: 'holder', title: 'My tickets.', page: <CollectionPage /> },
    '/tickets/receive': { role: 'holder', title: 'Receive a ticket.', page: <ReceivePage /> },
    '/tickets/transfer': { role: 'holder', title: 'Transfer a ticket.', page: <TransferPage /> },
    '/tickets/sample': { role: 'holder', title: 'Harbour Nights.', page: <SampleTicketPage /> },
    '/venue': { role: 'venue', title: 'Issue a ticket.', page: <VenuePage /> },
    '/scanner': { role: 'scanner', title: 'Scan a ticket.', page: <ScannerPage /> },
  }
  for (const [root, role] of [['/tickets', 'holder'], ['/venue', 'venue'], ['/scanner', 'scanner']] as const) {
    routes[`${root}/prepare`] = { role, title: 'Prepare for offline use.', page: <PreparationPage role={role} /> }
    routes[`${root}/headers`] = { role, title: 'Block headers.', page: <HeadersPage /> }
    routes[`${root}/activity`] = { role, title: 'App activity.', page: <ActivityPage /> }
  }
  const route = routes[path]
  useEffect(() => {
    document.title = `${path === '/' ? 'The ticket carries its own proof' : route?.title ?? (path === '/dev/feasibility' ? 'Development harness' : 'Page not found')} — Counterfoil`
  }, [path, route?.title])

  if (path === '/') return <LandingPage />
  if (path === '/dev/feasibility') return <FeasibilityScreen />
  if (route) return <Workspace role={route.role} title={route.title}>{route.page}</Workspace>
  return <main className="development-page">
    <a className="wordmark" href="/">Counterfoil.</a>
    <h1>Page not found.</h1>
    <p>This address does not match a Counterfoil page.</p>
    <a className="btn primary" href="/">Back to home</a>
  </main>
}
