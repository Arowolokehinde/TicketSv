import '../styles/readiness.css'
import { useEffect, useState } from 'react'
import { loadSnapshot } from '../headers/store.ts'
import { attendeeAppStatus } from '../offline/attendee-cache.ts'
import { canReopenOffline, offlineStorage } from '../offline/persist.ts'
import { offlineReadiness, readinessFacts, type ReadinessEnvironment } from '../handoff/readiness.ts'
import type { HandoffTicket, SenderRecord } from '../handoff/types.ts'
import type { WalletTransport } from '../wallet/connection.ts'

const stateText = { done: 'Done', waiting: 'Waiting', todo: 'To do', note: 'Note' } as const
// Everything offline signing needs, up front. Rechecked whenever an action ends.
export function OfflineReadiness({
  ticket,
  sender,
  transport,
  busy,
}: {
  ticket: HandoffTicket
  sender?: SenderRecord
  transport: WalletTransport
  busy: boolean
}): React.JSX.Element {
  const [env, setEnv] = useState<Omit<ReadinessEnvironment, 'transport'>>({ app: 'unknown' })
  useEffect(() => {
    if (busy) return
    const controller = new AbortController()
    void Promise.all([
      loadSnapshot().catch(() => undefined),
      canReopenOffline() ? attendeeAppStatus(controller.signal).catch(() => 'unknown' as const) : ('unsupported' as const),
      offlineStorage(),
    ]).then(([snapshot, app, storage]) => {
      if (!controller.signal.aborted) setEnv({ snapshotTip: snapshot?.headers.at(-1)?.height, app, storage: storage.kept })
    })
    return () => controller.abort()
  }, [busy, ticket, sender?.revision])
  const result = offlineReadiness(readinessFacts(ticket, sender), { ...env, transport })
  return (
    <section className="handoff-readiness" aria-label="Offline transfer readiness">
      <h3>{result.ready ? 'Ready for offline transfer' : 'Before you go offline'}</h3>
      <ul>
        {result.items.map(item => (
          <li key={item.key} data-state={item.state}>
            <strong>{item.label}</strong>
            <span className="readiness-state">{stateText[item.state]}</span>
            <p>{item.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
