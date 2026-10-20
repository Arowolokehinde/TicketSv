import { useState } from 'react'
import { IntegrationNotice } from './Workspace.tsx'
import { sampleTicket } from './samples.ts'

function TicketArtwork(): React.JSX.Element {
  return <div className="ticket-art">
    <div className="ticket-top"><span>{sampleTicket.type.toUpperCase()}</span><span>SAMPLE / {sampleTicket.id}</span></div>
    <h2>Harbour<br /><em>Nights.</em></h2>
    <div className="ticket-bottom">ONE TICKET. ITS EVIDENCE.<span className="ticket-seal">SAMPLE<br />TICKET</span></div>
    <span className="ticket-serial" aria-hidden="true">0142</span>
  </div>
}

export function CollectionPage(): React.JSX.Element {
  const [showSamples, setShowSamples] = useState(true)
  return <>
    <div className="home-intro"><p>Receive it. Keep the proof. Pass it on.</p><div className="home-actions">
      <a className="btn primary" href="/tickets/receive">Receive a ticket</a>
      <a className="btn" href="/tickets/transfer">Transfer a ticket</a>
    </div></div>
    <div className="home-prepare"><span className="prepare-mark" aria-hidden="true">↯</span><div><b>Before your next handoff</b><p>Prepare your wallet and required headers before disconnecting.</p></div><a href="/tickets/prepare">Prepare for offline use ↗</a></div>
    <div className="sample-control"><p>{showSamples ? 'Sample tickets — no real tickets saved.' : 'Your collection is empty.'}</p><button onClick={() => setShowSamples(!showSamples)}>{showSamples ? 'Hide sample tickets' : 'Show sample tickets'}</button></div>
    {showSamples ? <div className="home-grid">
      <article className="collection-ticket">
        <TicketArtwork />
        <div className="ticket-receipt">
          <span className="home-eyebrow">EXAMPLE STATUS / SAMPLE DATA</span>
          <div className="receipt-title">{sampleTicket.status}</div>
          <p>This illustrates a future saved ticket. Nothing has been verified or accepted.</p>
          <dl className="home-tracks">{sampleTicket.tracks.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <a className="receipt-link" href="/tickets/sample">View sample ticket &amp; evidence ↗</a>
        </div>
      </article>
      <div className="home-side">
        <article className="incomplete-ticket"><span className="home-eyebrow">SAMPLE / MISSING EVIDENCE</span><h2>One more check.</h2><span className="badge b-amber">Example: verification incomplete</span><p>If a required block header is missing, keep the package and sync before trying again.</p><a className="receipt-link" href="/tickets/prepare">View device preparation ↗</a></article>
        <aside className="handoff-note"><h3>Keep the package.<br />Keep the evidence.</h3><p>Offline acceptance cannot confirm a transfer or rule out a double-sale.</p></aside>
      </div>
    </div> : <section className="home-empty">
      <div className="empty-stub" aria-hidden="true"><span>COUNTERFOIL / ADMIT ONE</span><i>Yours, soon.</i><b>— — — — — — — — — —</b></div>
      <div><span className="home-eyebrow">A TICKET. ITS OWN EVIDENCE.</span><h2>No tickets saved yet.</h2><p>Your next event starts with a receiving request. Exchange it with the sender by QR or file.</p><a className="btn primary" href="/tickets/receive">Receive your first ticket</a></div>
    </section>}
    <footer className="home-foot"><span>LOCAL STORAGE / YOUR DEVICE</span><p>Real ticket saving and reopening will be enabled with the storage integration. Sample tickets are not stored packages.</p></footer>
  </>
}

export function SampleTicketPage(): React.JSX.Element {
  return <>
    <a className="receive-back" href="/tickets">← My tickets</a>
    <div className="sample-control"><p>Sample evidence — not verified on this device.</p></div>
    <div className="cols">
      <article className="collection-ticket"><TicketArtwork /><div className="ticket-receipt"><div className="receipt-title">{sampleTicket.status}</div><p>Illustrative status only.</p><dl className="home-tracks">{sampleTicket.tracks.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div></article>
      <section className="card"><h2 className="section-heading">The evidence inside.</h2><p>These are example checks, not verification results.</p><ol className="evidence-list">{sampleTicket.evidence.map(([name, description]) => <li key={name}><h3>{name}</h3><p>{description}</p></li>)}</ol><p className="limits">Mined inclusion does not prove the ticket is currently unspent. The scanner requires the latest transfer to be mined and flags unmined transfers for an online check.</p></section>
    </div>
  </>
}

export function ReceivePage(): React.JSX.Element {
  return <div className="receive-flow">
    <a className="receive-back" href="/tickets">← My tickets</a>
    <ol className="receive-steps"><li aria-current="step"><span>01</span>Share your request</li><li><span>02</span>Receive package</li><li><span>03</span>Verify &amp; save</li></ol>
    <section className="request-start">
      <span className="home-eyebrow">A HANDOFF STARTS WITH YOU</span>
      <h2>Give the seller<br /><em>somewhere to send it.</em></h2>
      <p>Your wallet supplies a receiving key. Share your receiving request by QR or file, then receive the seller’s signed ticket package.</p>
      <IntegrationNotice>Your wallet is not connected. Receiving requests will be available after wallet integration.</IntegrationNotice>
      <p>No receiving request has been created.</p>
      <div className="request-start-actions"><button className="btn primary" disabled>Create receiving request</button><a href="/tickets/prepare">Check device preparation</a></div>
      <small>Both people can exchange files remotely while connected, then check downloaded evidence offline on prepared devices.</small>
    </section>
  </div>
}

export function TransferPage(): React.JSX.Element {
  return <>
    <a className="receive-back" href="/tickets">← My tickets</a>
    <ol className="receive-steps"><li aria-current="step"><span>01</span>Choose a ticket</li><li><span>02</span>Confirm recipient</li><li><span>03</span>Sign &amp; share</li></ol>
    <section className="request-start"><span className="home-eyebrow">FROM YOUR HAND TO THEIRS</span><h2>A ticket.<br /><em>A new owner.</em></h2>
      <p>Choose a ticket you own, import the buyer’s receiving request by QR or file, then confirm their key before signing the transfer in your wallet.</p>
      <IntegrationNotice>No transferable ticket is available. The collection’s sample ticket cannot be signed or transferred.</IntegrationNotice>
      <div className="actions"><button className="btn primary" disabled>Choose ticket to transfer</button><a className="btn" href="/tickets">Back to my tickets</a></div>
    </section>
  </>
}
