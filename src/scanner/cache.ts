import { prepareAttendeeApp } from '../offline/attendee-cache.ts'
import { APP_WORKER } from '../offline/persist.ts'
// The scanner shares TicketSV's one offline app cache.
export const prepareScannerApp = prepareAttendeeApp
export async function scannerCacheStatus(): Promise<'ready' | 'waiting' | 'reload' | 'missing'> {
  if (!('serviceWorker' in navigator)) return 'missing'
  const registration = await navigator.serviceWorker.getRegistration('/')
  if (registration?.waiting) return 'waiting'
  if (!registration?.active) return 'missing'
  const ready = await new Promise<boolean>(resolve => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => {
        channel.port1.close()
        resolve(false)
      }, 3000)
    channel.port1.onmessage = e => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(e.data?.ready === true)
    }
    try {
      registration.active!.postMessage('CHECK_APP_CACHE', [channel.port2])
    } catch {
      clearTimeout(timer)
      channel.port1.close()
      resolve(false)
    }
  })
  if (!ready) return 'missing'
  return navigator.serviceWorker.controller?.scriptURL.endsWith(APP_WORKER) ? 'ready' : 'reload'
}
