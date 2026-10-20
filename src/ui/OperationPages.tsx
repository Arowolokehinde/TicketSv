import { IntegrationNotice, workspaceRoot, type WorkspaceRole } from './Workspace.tsx'

export function VenuePage(): React.JSX.Element {
  return <div className="cols">
    <section className="request-start">
      <span className="home-eyebrow">EVERY TICKET STARTS HERE</span><h2>Your event.<br /><em>Your signature.</em></h2>
      <p>The venue issues a PushDrop ticket and signs its authenticity evidence with its wallet identity. The recipient can check that signature against the trusted venue key.</p>
      <form className="venue-form" onSubmit={event => event.preventDefault()}>
        <fieldset disabled><legend>Ticket details / wallet connection required</legend>
          <label>Event name<input name="event" placeholder="Your event" /></label>
          <label>Ticket identifier<input name="ticket" placeholder="e.g. GA-0142" /></label>
          <label>Recipient receiving request<input name="recipient" placeholder="Import the recipient’s request" /></label>
        </fieldset>
        <IntegrationNotice>Connect the venue wallet once integration is available. No issuer identity is configured and no ticket has been minted.</IntegrationNotice>
        <button className="btn primary" disabled>Sign &amp; issue ticket</button>
      </form>
    </section>
    <aside className="handoff-note"><span className="home-eyebrow">AUTHENTICITY / INCLUSION</span><h3>Two different<br />pieces of proof.</h3><p>The venue signature establishes authorship. SPV checks transaction evidence against locally stored block headers.</p><p>Private keys stay in the wallet. A ticket package alone does not establish that its issuer is trusted.</p><a href="/venue/prepare">Prepare this device ↗</a></aside>
  </div>
}

export function ScannerPage(): React.JSX.Element {
  return <div className="cols">
    <section className="request-start">
      <span className="home-eyebrow">AT THE ENTRANCE</span><h2>The ticket.<br /><em>The evidence.</em></h2>
      <p>Scan a ticket package or import its file. The scanner checks its venue signature, transfer history and block proofs locally.</p>
      <div className="scanner-placeholder" aria-label="Camera is not active"><span aria-hidden="true">⌗</span><p>Camera not started</p></div>
      <IntegrationNotice>The local verifier and header store are not connected yet. Scanning and file verification will be available after integration.</IntegrationNotice>
      <div className="actions"><button className="btn primary" disabled>Start scanning</button><button className="btn" disabled>Import ticket file</button></div>
    </section>
    <aside className="handoff-note"><span className="home-eyebrow">SCANNER POLICY</span><h3>Check the<br />latest transfer.</h3><p>This POC requires the latest transfer to be mined. An unmined transfer needs an online check; missing headers leave verification incomplete.</p><p>Even mined inclusion cannot rule out an unseen later spend or repeated entry.</p><a href="/scanner/prepare">Prepare scanner offline ↗</a></aside>
  </div>
}

export function PreparationPage({ role }: { role: WorkspaceRole }): React.JSX.Element {
  const root = workspaceRoot[role]
  const checks = [
    ['App reopening', 'Not prepared', 'Offline caching and a closed-browser reopening test are still required.'],
    ['Local storage', 'Not initialized', 'Ticket-package persistence has not been connected.'],
    [role === 'scanner' ? 'Trusted venue identity' : 'Wallet access', 'Not configured', role === 'scanner' ? 'The scanner needs a trusted issuer key before it can establish authenticity.' : 'Wallet access must be tested on this device before offline handoff.'],
    ['Required block headers', 'Not synced', 'No local header snapshot is available.'],
    ...(role === 'scanner' ? [] : [['Signing and funding evidence', 'Not tested', 'Offline signing requires available keys and complete funding proofs.']]),
  ]
  return <>
    <div className="home-intro"><p>A little preparation. A handoff without a connection.</p></div>
    <div className="cols"><section className="card"><h2 className="section-heading">This device is not ready offline.</h2><p>These checks will run against the actual app, wallet and stored evidence once their integrations are connected.</p>
      <ul className="preparation-list">{checks.map(([name, status, detail]) => <li key={name}><div><h3>{name}</h3><span className="badge b-outline">{status}</span></div><p>{detail}</p></li>)}</ul>
      <button className="btn primary" disabled>Prepare this device</button>
    </section><aside className="handoff-note"><span className="home-eyebrow">BEFORE DISCONNECTING</span><h3>Prepare online.<br />Check offline.</h3><p>A later ticket may need headers newer than the ones saved here. Keep the package, reconnect and sync before retrying if evidence is missing.</p><a href={`${root}/headers`}>View header status ↗</a></aside></div>
  </>
}

export function HeadersPage(): React.JSX.Element {
  return <section className="request-start"><span className="home-eyebrow">THE LOCAL CHAIN VIEW</span><h2>Small headers.<br /><em>Independent checks.</em></h2>
    <p>Block headers give the local verifier a Merkle root to check each mined transaction against. Headers must be synced before going offline.</p>
    <dl className="kv"><dt>Local snapshot</dt><dd>None</dd><dt>Tip height</dt><dd>Not available</dd><dt>Last sync</dt><dd>Never</dd><dt>Sources</dt><dd>Not configured</dd></dl>
    <div className="request-notice"><b>Header sync is not connected yet.</b><p>No header download or verification has occurred.</p></div>
    <button className="btn primary" disabled>Sync headers</button>
    <p className="boundary">The planned POC validates proof of work and header linkage from a pinned checkpoint. Full difficulty-adjustment validation is outside its scope.</p>
  </section>
}

export function ActivityPage(): React.JSX.Element {
  return <section className="request-start"><span className="home-eyebrow">APP-OBSERVED ACTIVITY</span><h2>The checks.<br /><em>In the open.</em></h2>
    <p>This page will show header syncs, broadcasts and the app’s verification activity when those services are connected.</p>
    <div className="empty-activity"><span aria-hidden="true">—</span><h3>No blockchain activity yet.</h3><p>The app has not requested a header sync, wallet connection or transaction broadcast.</p></div>
    <p className="limits">The network recorder is not implemented yet. This is an uninitialized activity view, not a network audit. Loading the website requests its own assets; native wallet traffic is outside the future app log’s visibility.</p>
  </section>
}
