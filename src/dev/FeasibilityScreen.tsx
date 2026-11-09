import { ConflictExperimentPanel } from './ConflictExperimentPanel.tsx'
import { SettlementPanel } from './SettlementPanel.tsx'
import { WalletImportReviewPanel } from './WalletImportReviewPanel.tsx'
import { WalletImportPanel } from './WalletImportPanel.tsx'
import { DurableTicketPanel } from './DurableTicketPanel.tsx'
import { BSV_NETWORK } from '../config/network.ts'
import { feasibilityGates } from './feasibility.ts'
import { WalletConnectionPanel } from './WalletConnectionPanel.tsx'
import { TicketExperimentPanel } from './TicketExperimentPanel.tsx'
import { SpvExperimentPanel } from './SpvExperimentPanel.tsx'
import { SigningExperimentPanel } from './SigningExperimentPanel.tsx'

export function FeasibilityScreen(): React.JSX.Element {
  return (
    <main className="development-page">
      <p className="eyebrow">DEVELOPMENT ONLY / WALLET EXPERIMENTS</p>
      <section aria-labelledby="development-heading">
        <p className="eyebrow">THE FOUNDATION / REAL EVIDENCE COMES NEXT</p>
        <h1 id="development-heading">Development harness</h1>
        <p className="intro">Seven checks before we connect the ticket flows.</p>
        <div className="development-status" aria-label="Current integration status">
          <span data-network={BSV_NETWORK}>Testnet</span>
        </div>
        <p className="boundary">Wallet access starts only through the explicit controls below. Product ticket actions remain unavailable. Sample tickets do not establish that the integrations work.</p>
        <WalletConnectionPanel />
        <SigningExperimentPanel />
        <SpvExperimentPanel />
        <TicketExperimentPanel />
        <DurableTicketPanel />
        <SettlementPanel />
        <WalletImportReviewPanel />
        <WalletImportPanel />
        <ConflictExperimentPanel />
        <p><a href="/dev/reopening">Open offline reopening experiment ↗</a></p>
        <ol className="gate-list">
          {feasibilityGates.map((gate, index) => (
            <li key={gate.id}>
              <span className="gate-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="gate-label">{gate.label}</span>
              <span className="gate-status" data-status={gate.status}>Not tested</span>
            </li>
          ))}
        </ol>
        <p className="boundary">A connection observation alone does not close a compatibility gate. Record actual wallet versions, supported devices and reproducible results separately. No offline readiness or successful verification is claimed here.</p>
        <a className="preview-link" href="/">Open the TicketSV website ↗</a>
      </section>
    </main>
  )
}
