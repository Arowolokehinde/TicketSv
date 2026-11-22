import '../styles/update-banner.css'
import { useSyncExternalStore } from 'react'
import { applyUpdate, subscribeUpdate, updateWaiting } from '../offline/update.ts'

export function UpdateBanner(): React.JSX.Element | null {
  const waiting = useSyncExternalStore(subscribeUpdate, updateWaiting)
  if (!waiting) return null
  return (
    <div className="update-banner" role="status">
      <p>Update available. Reload when you&apos;re ready.</p>
      <button className="btn primary" aria-label="Reload" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  )
}
