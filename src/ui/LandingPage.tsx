import { AuthLink } from '../auth/AuthProvider.tsx'
import { useState } from 'react'
import { HandoffJourney } from './HandoffJourney.tsx'
import { LandingDetails } from './LandingDetails.tsx'

export function LandingPage(): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  return (
<main className={paused ? 'landing motion-paused' : 'landing'}>
 
 <section className="landing-hero">
  <div className="hero-copy">
    <h1>Your next event.<br /><em>Powered by BSV.</em></h1>
    <p>Send event tickets directly to someone else. They can check the ticket’s origin and transfer history on their device, even offline after setup.</p>
    <div className="hero-actions">
      <AuthLink className="btn primary landing-cta" href="/tickets">Open dashboard</AuthLink>
      <a className="hero-secondary" href="#how">See how it works <span aria-hidden="true">↓</span></a>
    </div>

  </div>
  <div className="hero-object">
    <div className="ticket-orbit" aria-hidden="true" />
    <svg className="hero-star" viewBox="0 0 80 80" aria-hidden="true">
      <path d="M40 0 47 25 68 12 55 33 80 40 55 47 68 68 47 55 40 80 33 55 12 68 25 47 0 40 25 33 12 12 33 25Z" fill="currentColor" />
    </svg>
    <div className="bsv-seal"><span>BUILT ON</span><strong>BSV</strong><span>TICKETSV / 01</span></div>
    <div className="floating-ticket">
      <div className="hero-ticket-main">
        <div className="ticket-top"><span>TICKETSV / EVENT PASS</span><span>ADMIT ONE</span></div>
        <h2>Your next<br /><em>event.</em></h2>
        <div className="hero-ticket-meta">
          <span>GENERAL ADMISSION<br />ONE TICKET. ITS EVIDENCE.</span>
          <span className="hero-stamp">VENUE<br />SIGNED ↗</span>
        </div>
      </div>
      <div className="hero-ticket-stub">
        <div><span>ENCLOSED WITH THE TICKET</span><strong>Signature. History. Proof.</strong></div>
        <div className="decorative-bars" aria-hidden="true" />
        <small>TICKET ILLUSTRATION</small>
      </div>
    </div>
    <div className="proof-slip">
      <span className="slip-check">✓</span>
      <div><b>Check the evidence.</b><small>Right on your device.</small></div><span>↗</span>
    </div>
    <div className="motion-row">
      <span>ILLUSTRATION · NOT LIVE VERIFICATION</span>
      <button className="motion-toggle" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        {paused ? 'Resume motion ▶' : 'Pause motion Ⅱ'}
      </button>
    </div>
  </div>
 </section>
 <div className="landing-ribbon"><span>VENUE SIGNATURES</span><i>✳</i><span>PEER TO PEER</span><i>✳</i><span>PROOF INCLUDED</span><i>✳</i><span>CHECKS ON YOUR DEVICE</span></div>
 <section className="landing-demo" id="how" aria-label="How it works">
   <div className="section-label">HOW IT WORKS</div>
 <HandoffJourney />
 </section>
 <LandingDetails />
</main>
  )
}
