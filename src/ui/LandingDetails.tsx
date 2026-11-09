import { AuthLink } from '../auth/AuthProvider.tsx'
const evidence = [
  { name: 'Venue signature', description: 'Check who issued the ticket.' },
  { name: 'Transaction history', description: 'Follow the ticket from its origin to you.' },
  { name: 'Block proof', description: 'Check mining evidence against saved headers.' },
] as const

function EvidenceIcon({ kind }: { kind: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {kind === 0 && <><path d="M24 5 40 12v12c0 9-9 16-16 19C17 40 8 33 8 24V12L24 5Z" /><path d="m16 24 6 6 11-13" /></>}
      {kind === 1 && <><rect x="5" y="7" width="15" height="15" rx="3" /><rect x="28" y="26" width="15" height="15" rx="3" /><path d="M12 28v7h10m-5-5 5 5-5 5M36 20v-7H26m5-5-5 5 5 5" /></>}
      {kind === 2 && <><path d="m24 5 17 10v19L24 44 7 34V15L24 5Z" /><path d="m7 15 17 10 17-10M24 25v19m-8-14 5 3" /></>}
    </svg>
  )
}

export function LandingDetails(): React.JSX.Element {
  return (
    <>
      <section className="landing-evidence" id="evidence" aria-labelledby="evidence-heading">
        <div className="section-label">INSIDE THE PACKAGE</div>
        <div className="landing-section-head">
          <h2 id="evidence-heading">What travels<br /><em>with your ticket?</em></h2>
        </div>
        <div className="evidence-pieces">
          {evidence.map((item, index) => (
            <article className="evidence-piece" key={item.name} aria-label={item.name}>
              <div className="evidence-piece-top"><EvidenceIcon kind={index} /><span>0{index + 1}</span></div>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-offline offline-explainer" aria-labelledby="offline-heading">
        <div className="section-label">KNOW WHAT OFFLINE MEANS</div>
        <div className="offline-intro">
          <h2 id="offline-heading">No connection<br /><em>at the handoff.</em></h2>
          <p>Prepare your app, wallet and evidence online. Then exchange and check the ticket on your device.</p>
          <a href="#faq" className="offline-more">A few things to know <span aria-hidden="true">↘</span></a>
        </div>
        <div className="offline-comparison">
          <div className="offline-phase">
            <span className="phase-icon" aria-hidden="true">✓</span>
            <div><span className="phase-label">ON YOUR DEVICE</span><h3>Check the evidence.</h3><p>Verify the signature and ticket history using the evidence you saved.</p></div>
          </div>
          <div className="offline-phase">
            <span className="phase-icon phase-online" aria-hidden="true">↗</span>
            <div><span className="phase-label">WHEN YOU RECONNECT</span><h3>Confirm the transfer.</h3><p>Submit the signed transfer and track its mining status. Wallet import is a separate step.</p></div>
          </div>
        </div>
      </section>

      <section className="landing-faq faq-layout" id="faq" aria-labelledby="faq-heading">
        <div className="section-label">BEFORE YOU GO OFFLINE</div>
        <div className="faq-intro">
          <div className="landing-section-head"><h2 id="faq-heading">A few things<br /><em>worth knowing.</em></h2></div>
        </div>
        <div className="evidence-folds faq-questions">
          <details><summary>Must I prepare my device first?<i aria-hidden="true">+</i></summary><div><p>Yes. Prepare the app, wallet and ticket evidence while online. If a check needs something you haven’t saved, reconnect to finish preparation. Guided preparation is not connected to the main website yet.</p></div></details>
          <details><summary>Can I use a file instead of QR?<i aria-hidden="true">+</i></summary><div><p>The planned handoff supports both. File-based experiments are available in the development harness; the main website’s handoff controls and QR exchange are still being integrated. Sending a file remotely needs a connection.</p></div></details>
          <details><summary>Does accepting offline confirm the transfer?<i aria-hidden="true">+</i></summary><div><p>No. Saving a ticket is separate from publishing and confirming its transfer. Saving and offline reopening are not connected to the main website yet. The planned flow tracks these stages separately.</p></div></details>
          <details><summary>Can offline verification detect a double-sale?<i aria-hidden="true">+</i></summary><div><p>No. Conflicting transfers may both pass local checks, but cannot both settle on the same chain. The experimental scanner flags unmined transfers for an online check. Even mined inclusion cannot rule out an unseen later spend or repeated entry.</p></div></details>
        </div>
      </section>

      <section className="landing-close closing-ticket" aria-labelledby="closing-heading">
        <div className="closing-copy"><span className="landing-kicker">KEEP THE TICKET. KEEP THE EVIDENCE.</span><h2 id="closing-heading">Ready for the<br /><em>next handoff?</em></h2></div>
        <div className="closing-action"><AuthLink className="btn primary" href="/tickets">Open dashboard</AuthLink></div>
      </section>
    </>
  )
}
