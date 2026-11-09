import { useEffect, useRef, useState } from 'react'
import type { VenueIssuance } from '../events/issuance-types.ts'
import type { HeaderSyncProgress } from '../headers/sync.ts'
import { loadSnapshot } from '../headers/store.ts'
import { attendeeEvidence, requireMinedEvidence } from '../offline/attendee-evidence.ts'
import { verifyVenueTicket } from '../events/verify-venue-ticket.ts'
import { attendeeImportStore, type AttendeeImportRecord } from '../wallet/attendee-import-store.ts'
import { importAttendeeTicket, reconcileAttendeeImport, reviewAttendeeImport, type AttendeeImportDependencies, type AttendeeImportReview } from '../wallet/attendee-import.ts'
import { openWalletClient } from '../wallet/connection.ts'

type Props = {
 record: VenueIssuance; owner: string; busy: boolean
 perform: (action: (signal: AbortSignal, check: () => void) => Promise<void>) => Promise<void>
 onProgress: (progress: HeaderSyncProgress) => void
}
export function PrepareTicketWallet({ record, owner, busy, perform, onProgress }: Props) {
 const [review, setReview] = useState<AttendeeImportReview>(), [journal, setJournal] = useState<AttendeeImportRecord>()
 const [consent, setConsent] = useState(false), [stage, setStage] = useState(''), [error, setError] = useState('')
 const [loaded, setLoaded] = useState(false), [blocked, setBlocked] = useState(false)
 const mounted = useRef(true)
 useEffect(() => {
  mounted.current = true; let cancelled = false
  setLoaded(false); setBlocked(false); setReview(undefined); setConsent(false); setJournal(undefined); setError('')
  // Loading the journal is local only. No wallet or network request runs here.
  void (async () => {
   try { const saved = await attendeeImportStore.load(attendeeEvidence(record, owner, location.origin)); if (!cancelled) setJournal(saved) }
   catch (failure) { if (!cancelled) { setBlocked(true); setError(`Saved wallet preparation could not be read. Do not retry importing. ${(failure as Error).message}`) } }
   finally { if (!cancelled) setLoaded(true) }
  })()
  return () => { cancelled = true; mounted.current = false }
 }, [record, owner])

 function run(kind: 'review' | 'import' | 'reconcile') {
  const approved = review
  if (kind === 'import' && (!approved || !consent || journal)) return
  setConsent(false)
  void perform(async (parentSignal, check) => {
   const controller = new AbortController(), abort = () => controller.abort(parentSignal.reason)
   parentSignal.addEventListener('abort', abort, { once: true }); if (parentSignal.aborted) abort()
   let timer: ReturnType<typeof setTimeout> | undefined
   const signal = controller.signal
   const guard = () => { signal.throwIfAborted(); check(); if (!navigator.onLine) throw Error('Stay online for wallet preparation and the wallet’s own proof checks.') }
   const deps: AttendeeImportDependencies = {
    source: async () => { guard(); const evidence = attendeeEvidence(record, owner, location.origin); const snapshot = await loadSnapshot(); guard(); return { evidence, snapshot } },
    wallet: async signal => {
     guard(); let method: string | null = null
     try { method = sessionStorage.getItem('ticketsv-wallet-transport') } catch { /* Default desktop connection. */ }
     return openWalletClient(method === 'browser-native' || method === 'desktop-https' ? method : 'desktop-http', signal)
    }, store: attendeeImportStore, guard,
   }
   setError(''); setStage(kind === 'import' ? 'Rechecking your approval before adding the ticket…' : 'Checking ticket evidence and preparing required headers…')
   if (kind === 'review') setReview(undefined)
   try {
    guard()
    if (kind !== 'import') {
     const evidence = attendeeEvidence(record, owner, location.origin)
     const verified = await verifyVenueTicket(evidence.pkg, { trustedVenueIdentity: evidence.trustedVenue, expectedRequest: evidence.proof.request, online: true, signal, onProgress: p => { guard(); onProgress(p) } })
     guard(); requireMinedEvidence(verified)
    }
    // Initial header preparation can take longer than a wallet permission prompt.
    // Start the wallet timeout only once verification data is available.
    timer = setTimeout(() => controller.abort(Error('Wallet preparation timed out. Review the saved outcome before trying again.')), 120000)
    if (kind === 'review') {
     setStage('Checking your wallet identity, receiving key and ticket record…')
     const saved = await attendeeImportStore.load(attendeeEvidence(record, owner, location.origin)); guard(); setJournal(saved)
     const next = await reviewAttendeeImport(signal, deps); guard(); setReview(next)
    } else if (kind === 'import') {
     setStage('Adding the reviewed ticket to your wallet. Review any wallet permission prompt…')
     const saved = await importAttendeeTicket(approved!, signal, deps)
     guard(); setJournal(saved); setReview(undefined)
     if (saved.attempt.outcome === 'accepted') {
      setStage('The wallet acknowledged the import. Checking its ticket record…')
      const observed = await reconcileAttendeeImport(signal, deps); guard(); setJournal(observed)
     }
    } else {
     setStage('Rechecking wallet records without retrying the import…')
     const observed = await reconcileAttendeeImport(signal, deps); guard(); setJournal(observed); setReview(undefined)
    }
   } catch (failure) {
    if (mounted.current) {
     setReview(undefined); setError(failure instanceof Error ? failure.message : 'Wallet preparation did not finish.')
     // Import may have completed despite cancellation. Recover only its local
     // diagnostic; this never dispatches another wallet action.
     try { const saved = await attendeeImportStore.load(attendeeEvidence(record, owner, location.origin)); if (mounted.current) setJournal(saved) }
     catch { if (mounted.current) { setBlocked(true); setError('The saved import outcome cannot be read. Do not retry importing; review wallet records.') } }
    }
   } finally {
    clearTimeout(timer); parentSignal.removeEventListener('abort', abort)
    controller.abort(); if (mounted.current) setStage('')
   }
  })
 }
 const observation = review?.wallet ?? journal?.observations.at(-1)
 const canImport = loaded && !blocked && !journal && review?.wallet.state === 'absent'
 return <section className="offline-save" aria-label="Prepare for handoff"><span className="home-eyebrow">PREPARE · WALLET RECORD</span><h3>Prepare this ticket for handoff.</h3>
 <p>Check that this ticket is recorded in your attendee wallet. Stay online and keep that wallet open on testnet.</p>
 <div className="actions">{!journal && <button className="btn" disabled={busy || !loaded || blocked} onClick={() => run('review')}>Check wallet readiness</button>}{journal && <button className="btn" disabled={busy || blocked} onClick={() => run('reconcile')}>Recheck wallet record</button>}</div>
 {stage && <p role="status">{stage}</p>}{error && <p className="event-error" role="alert">{error}</p>}
 {journal && <div aria-live="polite"><h4>Import response: {journal.attempt.outcome}</h4><p>{journal.attempt.outcome === 'accepted' ? 'The wallet acknowledged adding the ticket. Its output record is checked separately below.' : 'Wallet outcome needs review. Recheck its records; another import attempt is blocked.'}</p><p className="event-help">Attempt saved {new Date(journal.attempt.startedAt).toLocaleString()}. Reloading does not retry it.</p></div>}
 {observation && <div aria-live="polite"><h4>Latest wallet observation: {observation.state}</h4><p>{observation.reason}</p>{observation.state === 'present' && <><p className="event-saved">Ticket recorded in your wallet. Fee preparation is next.</p><a className="btn" href="/offline/handoff">Prepare fees and hand off</a></>}<p className="event-help">Observed {new Date(observation.checkedAt).toLocaleString()}. This is a saved observation; use the check button for a fresh result.</p></div>}
 {canImport && <div className="offline-import-review"><h4>Add this exact ticket to your wallet</h4><p>{record.event.name} · Ticket <code>{record.id}</code></p><dl><div><dt>Attendee account</dt><dd><code>{owner}</code></dd></div><div><dt>Ticket output</dt><dd><code>{record.pkg!.current.txid}.{record.pkg!.current.index}</code></dd></div><div><dt>Receiving key</dt><dd><code>{record.request.recipient.publicKey}</code></dd></div></dl><p>This updates wallet transaction, ownership and consumed-input records. It creates no new transfer and does not sign or broadcast a transaction.</p><label className="check-row"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I authorize adding this exact mined ticket to my attendee wallet and updating its wallet records.</label><button className="btn primary" aria-label="Add ticket to wallet" disabled={busy || !consent} onClick={() => run('import')}>Add ticket to wallet</button></div>}
 <p className="event-help">This step checks the wallet record only. Offline fee preparation and transfer signing come next. Wallet network traffic is not monitored by this page.</p>
 </section>
}
