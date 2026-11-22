import { APP_WORKER, canReopenOffline } from './persist.ts'

// Saves TicketSV for offline use on every online visit and offers a new version
// only once it is completely saved. Reload is always the person's choice, and
// it reloads every open TicketSV tab together.
const RETIRED = ['/offline/', '/scanner']
const listeners = new Set<() => void>()
let waiting: ServiceWorker | null = null

export const updateWaiting = (): boolean => waiting !== null
export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function setWaiting(worker: ServiceWorker | null) {
  waiting = worker
  for (const listener of listeners) listener()
}
const isApp = (url: string | undefined) => !!url && new URL(url).pathname === APP_WORKER

export function applyUpdate(): void {
  const worker = waiting
  if (!worker) return
  // A tab the worker does not control yet gets no controllerchange: reload it here.
  worker.addEventListener('statechange', () => {
    if (worker.state === 'activated' && !isApp(navigator.serviceWorker.controller?.scriptURL)) location.reload()
  })
  worker.postMessage('SKIP_WAITING')
}

function activeWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (registration.active) return Promise.resolve(registration.active)
  const installing = registration.installing ?? registration.waiting
  if (!installing) return Promise.resolve(null)
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 60000)
    installing.addEventListener('statechange', () => {
      if (installing.state === 'activated' || installing.state === 'redundant') {
        clearTimeout(timer)
        resolve(registration.active)
      }
    })
  })
}
function cacheComplete(worker: ServiceWorker): Promise<boolean> {
  return new Promise(resolve => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => resolve(false), 10000)
    channel.port1.onmessage = event => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(event.data?.ready === true)
    }
    worker.postMessage('CHECK_APP_CACHE', [channel.port2])
  })
}
// The earlier per-page workers are retired only once this one holds every app
// file; an update check fetches their replacement, which clears and unregisters.
async function retireOldWorkers(registration: ServiceWorkerRegistration) {
  const active = await activeWorker(registration)
  if (!active || !(await cacheComplete(active))) return
  for (const old of await navigator.serviceWorker.getRegistrations())
    if (RETIRED.some(scope => old.scope === new URL(scope, location.origin).href)) await old.update().catch(() => undefined)
}
async function register() {
  const registration = await navigator.serviceWorker.register(APP_WORKER, { scope: '/', updateViaCache: 'none' })
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return
    const check = () => {
      if (worker.state === 'installed' && registration.waiting === worker && registration.active) setWaiting(worker)
      if (worker.state === 'redundant' && waiting === worker) setWaiting(null)
    }
    worker.addEventListener('statechange', check)
    check()
  }
  track(registration.waiting)
  track(registration.installing)
  registration.addEventListener('updatefound', () => track(registration.installing))
  await retireOldWorkers(registration)
}
export function startOfflineApp(): void {
  if (!import.meta.env.PROD || !canReopenOffline()) return
  let controller = navigator.serviceWorker.controller?.scriptURL
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const next = navigator.serviceWorker.controller?.scriptURL
    // Only Reload lets one version of this worker replace another, so every tab follows it.
    if (isApp(controller) && isApp(next)) location.reload()
    controller = next
  })
  const start = () => void register().catch(() => undefined)
  if (document.readyState === 'complete') start()
  else addEventListener('load', start, { once: true })
}
