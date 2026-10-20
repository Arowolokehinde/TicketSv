import { BSV_NETWORK } from '../config/network.ts'
import { feasibilityGates } from './feasibility.ts'

export function FeasibilityScreen(): React.JSX.Element {
  return (
    <main className="development-page">
      <header className="development-header">
        <a className="wordmark" href="/design/counterfoil-ui.html#/">Counterfoil.</a>
        <span>DEVELOPMENT ONLY / NO LIVE OPERATIONS</span>
      </header>
      <section aria-labelledby="development-heading">
        <p className="eyebrow">THE FOUNDATION / REAL EVIDENCE COMES NEXT</p>
        <h1 id="development-heading">Development harness</h1>
        <p className="intro">Seven checks before we connect the ticket flows.</p>
        <div className="development-status" aria-label="Current integration status">
          <span data-network={BSV_NETWORK}>Testnet</span>
          <span>Wallet: not connected</span>
        </div>
        <p className="boundary">This scaffold does not contact a wallet or blockchain service. The design preview uses illustrative data; it does not establish that these integrations work.</p>
        <ol className="gate-list">
          {feasibilityGates.map((gate, index) => (
            <li key={gate.id}>
              <span className="gate-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="gate-label">{gate.label}</span>
              <span className="gate-status" data-status={gate.status}>Not tested</span>
            </li>
          ))}
        </ol>
        <p className="boundary">The next stage records actual wallet versions, supported devices and reproducible results. No offline readiness or successful verification is claimed here.</p>
        <a className="preview-link" href="/design/counterfoil-ui.html#/">Open the Counterfoil design preview ↗</a>
      </section>
    </main>
  )
}
