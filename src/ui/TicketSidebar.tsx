import { DashboardIcon, type DashboardIconName } from './DashboardIcon.tsx'
const links: Array<{ id: string; label: string; href: string; icon: DashboardIconName }> = [
  { id: 'dashboard', label: 'Dashboard', href: '/tickets', icon: 'grid' },
  { id: 'receive', label: 'Receive ticket', href: '/offline/handoff?step=receive', icon: 'receive' },
  { id: 'transfer', label: 'Transfer ticket', href: '/offline/handoff?step=prepare', icon: 'transfer' },
  { id: 'events', label: 'Explore events', href: '/events', icon: 'explore' },
  { id: 'create-event', label: 'Create event', href: '/venue', icon: 'calendar' },
  { id: 'my-events', label: 'My events', href: '/venue/my-events', icon: 'ticket' },
]
// Navigation has no account provider or network dependency, so it also works
// around the offline handoff screens without initiating authentication.
// waiting is the organiser's count of requests waiting for a ticket, when the page has it.
export function TicketSidebar({ active, disabled = false, waiting }: { active: string; disabled?: boolean; waiting?: number }) {
  return (
    <nav className="rail" aria-label="Ticket holder navigation">
      <div className="brand sidebar-label">Menu</div>
      {links.map(link => (
        <a
          key={link.id}
          href={link.href}
          aria-current={active === link.id ? 'page' : undefined}
          aria-disabled={disabled || undefined}
          onClick={event => {
            if (disabled) event.preventDefault()
          }}
        >
          <DashboardIcon name={link.icon} />
          <span>{link.id === 'my-events' && waiting ? `${link.label} (${waiting})` : link.label}</span>
        </a>
      ))}
      <div className="rail-note">
        The proof travels
        <br />
        with the ticket.
      </div>
    </nav>
  )
}
