import { useState } from 'react'
import type { VenueIssuance } from '../events/issuance-types.ts'
import type { HeaderSyncProgress } from '../headers/sync.ts'
import { attendeeEvidence, requireMinedEvidence } from '../offline/attendee-evidence.ts'
import { saveAttendeeTicket } from '../offline/attendee-store.ts'
import { prepareAttendeeApp, type OfflineAppStatus } from '../offline/attendee-cache.ts'
import { verifyVenueTicket } from '../events/verify-venue-ticket.ts'
import '../styles/offline-tickets.css'

type Props = {
 record: VenueIssuance; owner: string; busy: boolean
 perform: (action: (signal: AbortSignal, check: () => void) => Promise<void>) => Promise<void>
 onProgress: (progress: HeaderSyncProgress) => void
}
export function SaveOfflineTicket({ record, owner, busy, perform, onProgress }: Props) {
 const [saved, setSaved] = useState(false), [verified, setVerified] = useState(false), [app, setApp] = useState<OfflineAppStatus>()
 const [stage, setStage] = useState(''), [failure, setFailure] = useState('')
 function save() {
  void perform(async (signal, check) => {
   setApp(undefined); setVerified(false); setFailure(''); setStage('Checking ticket evidence and preparing required headers… Stay on this page.')
   try {
    const evidence = attendeeEvidence(record, owner, location.origin)
    const report = await verifyVenueTicket(evidence.pkg, { trustedVenueIdentity: evidence.trustedVenue, expectedRequest: evidence.proof.request, online: navigator.onLine, signal, onProgress: p => { check(); onProgress(p) } })
    check(); requireMinedEvidence(report); setVerified(true)
    setStage('Saving this ticket on your device… Stay on this page.')
    await saveAttendeeTicket(evidence, location.origin, signal, check)
    // The device copy has committed even if caching later fails or is cancelled.
    setSaved(true); check()
    setStage('Saving app files for offline reopening… Stay on this page.')
    const status = await prepareAttendeeApp(signal); check(); setApp(status)
   } catch (error) {
    // Keep failure feedback beside the action, including failures before any
    // evidence is written. The parent still releases its operation lock.
    setFailure(error instanceof Error ? error.message : 'Saving failed. Please try again while online.')
   } finally { setStage('') }
  })
 }
 return <section className="offline-save" aria-label="Save for offline use"><h3>Keep this ticket on your device.</h3><p>Save its evidence and the app files so you can reopen and verify it offline.</p><p className="event-help">The copy stays after sign-out. Anyone using this browser profile can view it. Wallet keys and login sessions are not saved.</p><div className="actions"><button className="btn primary" aria-label="Save for offline use" disabled={busy} onClick={save}>{stage ? 'Saving…' : 'Save for offline use'}</button><a className="btn" href="/offline/tickets" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}>Open saved tickets</a></div>
 {stage && <p role="status">{stage}</p>}
 {failure && <p className="event-error" role="alert">Save did not finish: {failure}</p>}
 {(saved || verified || app) && <div aria-live="polite"><ul className="offline-save-status"><li>Ticket: {saved ? 'saved on this device' : 'not saved yet'}</li><li>Evidence: {verified ? 'verified, including mining inclusion' : 'needs a fresh check'}</li><li>Offline app: {app === 'ready' ? 'available' : app === 'waiting' ? 'update waiting' : 'not confirmed'}</li></ul>
 {app === 'ready' && <p>Open saved tickets, then press ⌘D on Mac or Ctrl+D on Windows/Linux to bookmark that page. Disconnect external internet, close that tab, then reopen the same address in this browser profile and verify locally.</p>}
 {app === 'waiting' && <p>New app files saved. Close all Saved tickets tabs, reopen Saved tickets while online, then save again from Dashboard to confirm the active app before disconnecting.</p>}
 {saved && !app && !stage && <p>Your ticket copy is saved, but offline app preparation is not confirmed. Stay online and try saving again.</p>}</div>}
 <p className="event-help">Transfer preparation is next. This action makes no wallet requests and does not prepare keys or fees for signing.</p></section>
}
