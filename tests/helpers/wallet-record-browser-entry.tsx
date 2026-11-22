import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { PrepareTicketWallet } from '../../src/ui/PrepareTicketWallet.tsx'
import type { VenueIssuance } from '../../src/events/issuance-types.ts'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'
import '../../src/styles/approved.css'
import '../../src/styles/website.css'
import '../../src/styles/dashboard.css'
import '../../src/styles/attendee-steps.css'
export { saveSnapshot } from '../../src/headers/store.ts'
function Screen({ record, owner }: { record: VenueIssuance; owner: string }) {
  const [busy, setBusy] = useState(false),
    [present, setPresent] = useState(false)
  return (
    <div className="attendee-dashboard">
      <section className="attendee-ticket-flow">
        <div className="attendee-current-step">
          <PrepareTicketWallet
            record={record}
            owner={owner}
            busy={busy}
            onPresenceChange={setPresent}
            onProgress={() => {}}
            perform={async action => {
              setBusy(true)
              try {
                await action(new AbortController().signal, () => {})
              } finally {
                setBusy(false)
              }
            }}
          />
          <p>{present ? 'Preparation complete' : 'Wallet check pending'}</p>
        </div>
      </section>
    </div>
  )
}
export function mount(record: VenueIssuance, owner: string) {
  createRoot(document.getElementById('root')!).render(<Screen record={record} owner={owner} />)
}
