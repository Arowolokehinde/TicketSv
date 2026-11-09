import { headerProgressText, SHARED_HEADER_TRUST, SHARED_HEADERS_ENABLED } from '../headers/cached-sync.ts'
import { VenueRequests } from './VenueRequests.tsx'
import type { AttendeeRequest } from '../marketplace/types.ts'
import { useEffect, useRef, useState } from 'react'
import type { WalletInterface } from '@bsv/sdk'
import { api, currentAuthEpoch, currentAuthIdentity } from '../auth/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { AccountEvent } from '../events/api.ts'
import type { VenueIssuance as Issuance } from '../events/issuance-types.ts'
import { recoveryCandidate } from '../events/issuance-recovery.ts'
import { venueEvidence } from '../events/issuance-journal.ts'
import type { TicketPackage, Verification } from '../tickets/types.ts'
import { openWalletClient, type WalletTransport } from '../wallet/connection.ts'
import type { HeaderSyncProgress } from '../headers/sync.ts'

function download(name: string, data: unknown) {
 const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
 const link = document.createElement('a'); link.href = url; link.download = name; link.click()
 setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function VenueIssuance({ event, onClose }: { event: AccountEvent; onClose: () => void }): React.JSX.Element {
 const { session } = useAuth(), owner = session!.identityKey, base = `/api/events/${event.id}/issuances`
 const [records, setRecords] = useState<Issuance[]>([]), [selected, setSelected] = useState<string>()
 const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
 const [consent, setConsent] = useState(false), [report, setReport] = useState<Verification>()
 const [verifying, setVerifying] = useState(false), [headerProgress, setHeaderProgress] = useState<HeaderSyncProgress>()
 const [recovery, setRecovery] = useState<TicketPackage>()
 const [transport, setTransport] = useState<WalletTransport>(() => {
  try { const value = sessionStorage.getItem('ticketsv-wallet-transport'); if (value === 'desktop-https' || value === 'browser-native') return value } catch { /* default */ }
  return 'desktop-http'
 })
 const active = useRef<AbortController | null>(null), mounted = useRef(true), loadVersion = useRef(0)
 const ticketId = useRef(crypto.randomUUID())
 const record = records.find(item => item.id === selected)
 const candidate = recoveryCandidate(record?.pkg, recovery)
 const needsSave = Boolean(candidate)
 const accept = (value: Issuance) => { if (!mounted.current) return; setRecords(items => [value, ...items.filter(item => item.id !== value.id)]); setSelected(value.id) }
 async function reload() {
  const version = ++loadVersion.current
  setError(''); setLoaded(false); setConsent(false); setReport(undefined)
  try {
   const result = await api<{ issuances: Issuance[] }>(base)
   if (mounted.current && version === loadVersion.current) {
    setRecords(result.issuances); setSelected(result.issuances[0]?.id); setLoaded(true)
   }
  } catch (failure) { if (mounted.current && version === loadVersion.current) setError((failure as Error).message) }
 }
 useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; loadVersion.current++; active.current?.abort() } }, [])
 useEffect(() => {
  let current = true; setRecovery(undefined); setReport(undefined); setConsent(false)
  if (selected) void venueEvidence(owner, selected).then(pkg => { if (current) setRecovery(pkg) }).catch(failure => { if (current) setError((failure as Error).message) })
  return () => { current = false }
 }, [selected, owner])
 useEffect(() => {
  if (!busy && !needsSave) return
  const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
  window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
 }, [busy, needsSave])
 async function perform(operation: (wallet: WalletInterface, check: () => void) => Promise<void>) {
  if (active.current || !loaded) return
  const controller = new AbortController(), epoch = currentAuthEpoch()
  active.current = controller; setBusy(true); setError(''); setNotice(''); setReport(undefined)
  const check = () => { controller.signal.throwIfAborted(); if (!mounted.current || currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner) throw Error('The signed-in account changed. Stop and review this attempt.') }
  const timer = setTimeout(() => controller.abort(Error('Wallet operation timed out. Any started issuance must be reviewed; do not repeat it.')), 60_000)
  try {
   const client = await openWalletClient(transport, controller.signal); check()
   const allowed = new Set(['getNetwork', 'getPublicKey', 'createAction', 'createSignature', 'listOutputs'])
   const wallet = new Proxy(client, { get(target, key) {
    if (typeof key !== 'string' || !allowed.has(key)) throw Error('Unsupported issuance wallet method.')
    return async (...args: unknown[]) => {
     check()
     const method = target[key as keyof WalletInterface] as (...args: unknown[]) => Promise<unknown>
     const result = await method.apply(target, args); check(); return result
    }
   } })
   await Promise.race([operation(wallet, check), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? Error('Operation stopped. Review the saved attempt.')), { once: true }))])
  } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Operation failed. Review the saved attempt before continuing.') }
  finally { clearTimeout(timer); controller.abort(); if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false) } }
 }
 const prepare = () => perform(async (wallet, check) => {
  const { prepareVenueRecipient } = await import('../wallet/venue-issuance.ts'); check()
  const request = await prepareVenueRecipient(wallet, owner, ticketId.current); check()
  const saved = await api<Issuance>(base, { method: 'POST', body: JSON.stringify({ ticketId: ticketId.current, eventRevision: event.revision, request }) }); check()
  accept(saved); ticketId.current = crypto.randomUUID(); setNotice('Review saved. No transaction has been created.'); setConsent(false)
 })
 async function reviewAttendee(request: AttendeeRequest) {
  if (busy || active.current) return
  if (request.ticketId) {
   const found = records.find(item => item.id === request.ticketId)
   if (found) { setSelected(found.id); return }
   setBusy(true); setError('')
   try { accept(await api<Issuance>(`${base}/${request.ticketId}`)) }
   catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }
   return
  }
  setBusy(true); setError(''); setConsent(false); setReport(undefined)
  try { accept(await api<Issuance>(base, { method: 'POST', body: JSON.stringify({ ticketId: crypto.randomUUID(), attendeeRequestId: request.id }) })); setNotice('Review the attendee and event below. No transaction has been created.') }
  catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }
 }
 const issue = () => {
  if (!record || record.status !== 'prepared' || !consent) return
  void perform(async (wallet, check) => {
   const { issueVenueTicket, issueAttendeeTicket, checkVenueWallet } = await import('../wallet/venue-issuance.ts'); check()
   await checkVenueWallet(wallet, owner); check()
   if (record.attendeeRequestId && !record.attendeeProof) throw Error('The attendee request is missing. Reload the record before continuing.')
   // Mark locally blocked even if the server response is lost. Reload only reads.
   accept({ ...record, status: 'pending' }); setConsent(false)
   const claimed = await api<Issuance>(`${base}/${record.id}/start`, { method: 'POST', body: '{}' }); check(); accept(claimed)
   const checkpoint = async (txid: string) => {
    check(); const saved = await api<Issuance>(`${base}/${record.id}/reference`, { method: 'POST', body: JSON.stringify({ txid }) }); check(); accept(saved)
   }
   const pkg = record.attendeeProof ? await issueAttendeeTicket(wallet, owner, record.eventId, record.id, record.attendeeProof, checkpoint) : await issueVenueTicket(wallet, owner, record.eventId, record.id, record.request, checkpoint)
   check(); setRecovery(pkg)
   await venueEvidence(owner, record.id, pkg); check()
   const saved = await api<Issuance>(`${base}/${record.id}/evidence`, { method: 'POST', body: JSON.stringify({ pkg }) }); check(); accept(saved)
   setNotice('Ticket and venue signature saved. Mining has not yet been verified.')
  })
 }
 async function saveRecovery() {
  if (!record || !candidate || busy) return
  setBusy(true); setError('')
  try { accept(await api<Issuance>(`${base}/${record.id}/evidence`, { method: 'POST', body: JSON.stringify({ pkg: candidate }) })); if (mounted.current) setNotice('Existing evidence saved. No wallet transaction was repeated.') }
  catch (failure) { if (mounted.current) setError((failure as Error).message) } finally { if (mounted.current) setBusy(false) }
 }
 const refresh = () => perform(async (wallet, check) => {
  if (!record?.pkg) return
  const { refreshIssuanceEvidence } = await import('../wallet/durable-ticket.ts'); check()
  const pkg = await refreshIssuanceEvidence(wallet, record.pkg, owner); check()
  setRecovery(pkg); await venueEvidence(owner, record.id, pkg); check()
  accept(await api<Issuance>(`${base}/${record.id}/evidence`, { method: 'POST', body: JSON.stringify({ pkg }) })); check()
  setNotice('Mining evidence saved. Verify it against your local headers below.')
 })
 async function verify() {
  if (!record?.pkg || busy || active.current) return
  const controller = new AbortController(), epoch = currentAuthEpoch()
  active.current = controller
  const check = () => { controller.signal.throwIfAborted(); if (!mounted.current || currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner) throw Error('The signed-in account changed. Verify again after signing in.') }
  setBusy(true); setVerifying(true); setError(''); setNotice(''); setReport(undefined); setHeaderProgress(undefined)
  try {
   const { verifyVenueTicket } = await import('../events/verify-venue-ticket.ts'); check()
   const result = await verifyVenueTicket(record.pkg, {
    trustedVenueIdentity: owner, expectedRequest: record.request, online: navigator.onLine, signal: controller.signal,
    onProgress: progress => { check(); setHeaderProgress(progress) },
   }); check()
   setReport(result)
   if (result.verdict === 'incomplete' && !navigator.onLine) setNotice('Connect to the internet and click Verify ticket again. Missing verification data will be downloaded here automatically.')
  } catch (failure) { if (mounted.current) setError((failure as Error).message) }
  finally { controller.abort(); if (active.current === controller) active.current = null; if (mounted.current) { setBusy(false); setVerifying(false) } }
 }
 const unresolved = records.some(item => item.status !== 'complete'), pkg = candidate ?? record?.pkg
 return <section className="venue-issuance" aria-labelledby="issuance-heading">
  <div className="event-editor-heading"><div><span className="home-eyebrow">VENUE · TESTNET</span><h2 id="issuance-heading">Issue a ticket</h2><p>{event.name}</p></div><button className="btn" disabled={busy} onClick={onClose}>Back to events</button></div>
  <p>Review an attendee request to issue directly to their wallet key, or review a new ticket for your own connected wallet.</p>
  <VenueRequests eventId={event.id} disabled={busy || !loaded} onReview={request => void reviewAttendee(request)} />
  <div className="actions"><button className="btn" disabled={busy} onClick={() => void reload()}>Reload ticket records</button>{!unresolved && <button className="btn primary" disabled={busy || !loaded} onClick={() => void prepare()}>Review new ticket</button>}</div>
  {!loaded && !error && <p role="status">Loading ticket records…</p>}
  <details className="wallet-advanced"><summary>Wallet connection</summary><label>Connection method<select value={transport} disabled={busy} onChange={e => setTransport(e.target.value as WalletTransport)}><option value="desktop-http">BSV Desktop · Local HTTP</option><option value="desktop-https">BSV Desktop · Local HTTPS</option><option value="browser-native">BSV Browser · Native wallet</option></select></label></details>
  {records.length > 1 && <label>Saved tickets<select disabled={busy} value={selected ?? ''} onChange={e => setSelected(e.target.value)}>{records.map(item => <option key={item.id} value={item.id}>{item.id} · {item.status}</option>)}</select></label>}
  {record && <div className="issuance-review">
   <dl><div><dt>Ticket ID</dt><dd><code>{record.id}</code></dd></div><div><dt>Event at review</dt><dd>{record.event.name} · {record.event.date} · {record.event.time} ({record.event.timezone})<br />{record.event.venue} · Revision {record.eventRevision}</dd></div>{record.attendeeProof && <div><dt>Attendee account</dt><dd><code>{record.attendeeProof.attendee}</code><br />Direct issuance to this attendee; this does not transfer an existing ticket.</dd></div>}<div><dt>Recipient key</dt><dd><code>{record.request.recipient.publicKey}</code></dd></div><div><dt>Attempt</dt><dd>{record.status === 'complete' ? 'Ticket evidence saved' : record.status === 'prepared' ? 'Ready for your approval' : 'Started · outcome requires review'}</dd></div>{record.txid && <div><dt>Transaction ID</dt><dd><code>{record.txid}</code></dd></div>}</dl>
   {record.status === 'prepared' && <><p>Creates a 1-satoshi ticket output plus wallet funding, change and fees. Your wallet selects the funding and fee. The venue signature is requested after the transaction returns; declining that signature does not undo a broadcast.</p><label className="issuance-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />I authorize this testnet ticket, its wallet broadcast, funding fees and venue signature.</label><button className="btn primary" aria-label="Issue and broadcast ticket" disabled={busy || !consent} onClick={issue}>Issue and broadcast ticket</button></>}
   {record.status === 'pending' && <p className="event-error">This attempt needs review before another ticket can be issued. Reloading checks the saved record; it does not repeat the wallet transaction.</p>}
   <details className="wallet-advanced"><summary>Downloads and records (optional)</summary><p>Keep copies for backup or sharing. Downloads are not needed to verify this ticket here.</p>
   <div className="actions"><button className="btn" disabled={busy} onClick={() => download('ticketsv-issuance-record.json', record)}>Download issuance record</button><button className="btn" disabled={busy} onClick={() => download('ticketsv-receiving-request.json', record.request)}>Download receiving request</button></div>
   {pkg && <div className="actions"><button className="btn" onClick={() => download('ticketsv-ticket-package.json', pkg)}>Download ticket package</button><button className="btn" onClick={() => download('ticketsv-spv-evidence.json', { kind: 'counterfoil-signing-result', network: 'testnet', final: { txid: pkg.current.txid, atomicBeefBase64: pkg.atomicBeefBase64 } })}>Download SPV evidence</button></div>}
   </details>
   {needsSave && <button className="btn" disabled={busy} onClick={() => void saveRecovery()}>Save existing evidence again</button>}
   {record.pkg && <><h3>Mining and verification</h3>{record.attendeeRequestId && <p>The attendee can check mining evidence in their Dashboard. This output belongs to their receiving key.</p>}<p>Verify your ticket evidence. Any missing block headers are downloaded and saved here automatically while online.</p><div className="actions">{!record.attendeeRequestId && <button className="btn" disabled={busy} onClick={() => void refresh()}>Refresh mining evidence</button>}<button className="btn primary" aria-label="Verify ticket" disabled={busy} onClick={() => void verify()}>Verify ticket</button>{verifying && <button className="btn" onClick={() => active.current?.abort(Error('Verification cancelled. Any validated headers already saved will be reused next time.'))}>Cancel verification</button>}</div><p className="event-help">{SHARED_HEADERS_ENABLED ? <>Missing headers are prepared in shared batches and saved on this device. Later checks reuse them. {SHARED_HEADER_TRUST}</> : 'The first preparation can take several minutes. Later checks reuse saved headers and can run offline when all required data is available.'}</p></>}
  </div>}
  {busy && <p role="status">{verifying ? headerProgress ? headerProgressText(headerProgress) : 'Checking saved ticket evidence and preparing any missing headers…' : 'Working… review any request in your wallet. Do not repeat the action.'}</p>}
  {notice && <p className="event-saved" role="status">{notice}</p>}{error && <p className="event-error" role="alert">{error}</p>}
  {report && <div className="issuance-report"><h3>Ticket verification: {report.verdict}</h3><ul>{report.checks.map(item => <li key={item.name}>{item.name}: {item.status} — {item.reason}</li>)}</ul><p>{report.presentedTransferMined ? 'Mining inclusion verified against the saved local snapshot.' : 'Mining inclusion is not verified.'} Local verification server contacts: 0.</p></div>}
  <p className="event-help">The venue signature binds the event ID, ticket ID and original output. The event details shown here are the saved review snapshot. Local headers retain the experiment’s checkpoint and difficulty-validation limits; this does not establish current unspentness or admission.</p>
 </section>
}
