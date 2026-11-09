import { workspaceRoot, type WorkspaceRole } from './Workspace.tsx'

export function PreparationPage({ role }: { role: WorkspaceRole }): React.JSX.Element {
  const root = workspaceRoot[role]
  if (role !== 'scanner') return <section className="request-start">
    <span className="home-eyebrow">BEFORE YOU DISCONNECT</span>
    <h2>Prepare with your ticket.</h2>
    <p>Offline preparation is part of receiving or transferring a ticket. Open the relevant flow to prepare the app and required evidence for that ticket.</p>
    <div className="actions"><a className="btn primary" href="/offline/handoff?step=receive">Receive a ticket</a><a className="btn" href="/offline/handoff?step=prepare">Transfer a ticket</a></div>
  </section>
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
    <div className="empty-activity"><span aria-hidden="true">—</span><h3>No activity journal yet.</h3><p>Wallet connection checks are shown in the wallet panel. A saved activity history is not available here yet.</p></div>
    <p className="limits">The network recorder is not implemented yet. This is an uninitialized activity view, not a network audit. Loading the website requests its own assets; native wallet traffic is outside the future app log’s visibility.</p>
  </section>
}
