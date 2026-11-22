// Asks the browser to keep TicketSV's saved data instead of clearing it after
// a period without visits. Browsers decide; saving never waits on the answer.
export async function keepOfflineData(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persist?.()
  } catch {
    return undefined
  }
}
export function storageState(persisted: boolean | undefined, estimate?: { usage?: number }): { kept: boolean | undefined; text: string } {
  const used = estimate?.usage ? ` · ${(estimate.usage / 1_000_000).toFixed(1)} MB used` : ''
  if (persisted === true) return { kept: true, text: `Kept on this device${used}` }
  if (persisted === false) return { kept: false, text: 'The browser may clear TicketSV’s data after a period without visits' }
  return { kept: undefined, text: 'This browser does not say whether it keeps saved data' }
}
export async function offlineStorage(): Promise<ReturnType<typeof storageState>> {
  const ask = async <T>(read: (() => Promise<T>) | undefined) => {
    try {
      return await read?.()
    } catch {
      return undefined
    }
  }
  const storage = navigator.storage
  return storageState(await ask(storage?.persisted?.bind(storage)), await ask(storage?.estimate?.bind(storage)))
}
// TicketSV's one offline app worker, at scope /.
export const APP_WORKER = '/ticketsv-offline-worker.js'
// Without a service worker on a secure page, a reload offline cannot reopen the app.
export const canReopenOffline = (): boolean => 'serviceWorker' in navigator && isSecureContext
export function storageError(error: DOMException | null | undefined, fallback: string): Error {
  return Error(
    error?.name === 'QuotaExceededError' ? 'This device is out of space; nothing was saved. Free some space before continuing.' : fallback,
  )
}
