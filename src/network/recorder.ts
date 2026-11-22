import { ARC_TESTNET } from '../settlement/types.ts'

// Records every request this page sends through fetch, so reports can state
// measured network use instead of a fixed claim. Only method, host and path are
// kept: never query strings, bodies, cookies or headers.
export type NetworkOutcome = 'ok' | 'http-error' | 'failed' | 'offline' | 'aborted'
export type NetworkRequest = {
  at: number
  method: string
  host: string
  path: string
  purpose: string
  outcome: NetworkOutcome
  status?: number
  ms?: number
}
export type NetworkWindow = {
  label: string
  startedAt: number
  endedAt: number
  measured: boolean
  requests: NetworkRequest[]
  requestCount: number
  otherLoads: number | null
  verdict?: string
}
export type NetworkActivity = { requests: NetworkRequest[]; checks: NetworkWindow[] }
export type NetworkRecorder = {
  measure<T>(
    label: string,
    run: () => Promise<T>,
    verdict?: (value: T) => string | undefined,
  ): Promise<{ value: T; network: NetworkWindow }>
  read(): NetworkActivity
  subscribe(listener: () => void): () => void
  clear(): void
}
type Storage_ = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const KEY = 'ticketsv-network-activity-v1',
  MAX_REQUESTS = 200,
  MAX_CHECKS = 50,
  CHECK_REQUESTS = 20,
  MAX_LOADS = 500
const arc = new URL(ARC_TESTNET)

export function purposeOf(url: URL, origin: string): string {
  if (url.origin === origin) {
    const path = url.pathname
    if (path.startsWith('/api/headers/')) return 'TicketSV headers'
    if (path.startsWith('/api/auth/') || path === '/.well-known/auth') return 'TicketSV sign-in'
    return path.startsWith('/api/') ? 'TicketSV API' : 'TicketSV site'
  }
  if (url.hostname === 'api.whatsonchain.com') return 'WhatsOnChain'
  if (url.host === arc.host) return url.pathname.startsWith('/chaintracks') ? 'Chaintracks' : 'ARC'
  if (['localhost', '127.0.0.1'].includes(url.hostname) && ['3321', '2121'].includes(url.port)) return 'BSV Desktop wallet'
  return url.host
}

function saved(storage?: Storage_): NetworkActivity {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? 'null')
    if (Array.isArray(value?.requests) && Array.isArray(value?.checks))
      return { requests: value.requests.slice(-MAX_REQUESTS), checks: value.checks.slice(-MAX_CHECKS) }
  } catch {
    /* A damaged or blocked journal starts empty. */
  }
  return { requests: [], checks: [] }
}

export function createNetworkRecorder(o: {
  target: { fetch: typeof fetch }
  origin: string
  storage?: Storage_
  online?: () => boolean
  now?: () => number
  observeResources?: boolean
}): NetworkRecorder {
  const now = o.now ?? Date.now,
    online = o.online ?? (() => true),
    listeners = new Set<() => void>()
  let { requests, checks } = saved(o.storage)
  const changed = () => {
    try {
      o.storage?.setItem(KEY, JSON.stringify({ requests, checks }))
    } catch {
      /* The in-memory journal still works. */
    }
    for (const listener of listeners)
      try {
        listener()
      } catch {
        /* One view never blocks another. */
      }
  }
  // Resource Timing cross-check: loads that did not go through fetch.
  const loads: number[] = []
  const note = (entries: PerformanceEntry[]) => {
    for (const entry of entries)
      if ((entry as PerformanceResourceTiming).initiatorType !== 'fetch') loads.push(performance.timeOrigin + entry.startTime)
    loads.splice(0, Math.max(0, loads.length - MAX_LOADS))
  }
  let observer: PerformanceObserver | undefined
  if (o.observeResources !== false && typeof PerformanceObserver === 'function' && typeof performance !== 'undefined') {
    try {
      observer = new PerformanceObserver(list => note(list.getEntries()))
      observer.observe({ type: 'resource', buffered: false })
    } catch {
      observer = undefined
    }
  }
  const original = o.target.fetch
  o.target.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const at = now()
    let url: URL | undefined,
      method = 'GET'
    try {
      const request = typeof Request === 'function' && input instanceof Request ? input : undefined
      url = new URL(request ? request.url : input instanceof URL ? input.href : String(input), o.origin)
      method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    } catch {
      /* Unparseable input is still recorded and passed on unchanged. */
    }
    const record = (outcome: NetworkOutcome, status?: number) => {
      requests = [
        ...requests,
        {
          at,
          method,
          host: url?.host ?? 'unknown',
          path: url?.pathname ?? '',
          purpose: url ? purposeOf(url, o.origin) : 'unknown',
          outcome,
          ...(status === undefined ? {} : { status }),
          ms: Math.max(0, now() - at),
        },
      ].slice(-MAX_REQUESTS)
      changed()
    }
    return (Reflect.apply(original, o.target, [input, init]) as Promise<Response>).then(
      response => {
        record(response.status >= 400 ? 'http-error' : 'ok', response.status)
        return response
      },
      error => {
        record((error as Error)?.name === 'AbortError' ? 'aborted' : online() ? 'failed' : 'offline')
        throw error
      },
    )
  } as typeof fetch
  return {
    async measure(label, run, verdict) {
      const startedAt = now()
      let value,
        failure: unknown,
        failed = false
      try {
        value = await run()
      } catch (error) {
        failed = true
        failure = error
      }
      if (observer) note(observer.takeRecords())
      const endedAt = now(),
        inside = requests.filter(r => r.at >= startedAt && r.at <= endedAt)
      const network: NetworkWindow = {
        label,
        startedAt,
        endedAt,
        measured: true,
        requests: inside.slice(-CHECK_REQUESTS),
        requestCount: inside.length,
        otherLoads: observer ? loads.filter(t => t >= startedAt && t <= endedAt).length : null,
      }
      const result = failed ? 'error' : verdict?.(value as never)
      if (result) network.verdict = result
      checks = [...checks, network].slice(-MAX_CHECKS)
      changed()
      if (failed) throw failure
      return { value: value as never, network }
    },
    read: () => ({ requests, checks }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      requests = []
      checks = []
      try {
        o.storage?.removeItem(KEY)
      } catch {
        /* Nothing saved to clear. */
      }
      for (const listener of listeners)
        try {
          listener()
        } catch {
          /* ignored */
        }
    },
  }
}

let recorder: NetworkRecorder | undefined
const windows = new WeakMap<object, NetworkWindow>()
// Installed first from main.tsx: the SDK binds window.fetch when it creates a
// client, so a later install would miss its requests.
export function installNetworkRecorder(): void {
  if (recorder || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  let storage: Storage_ | undefined
  try {
    storage = window.localStorage
  } catch {
    storage = undefined
  }
  recorder = createNetworkRecorder({ target: window, origin: location.origin, storage, online: () => navigator.onLine })
}
const reportVerdict = (value: unknown) =>
  typeof (value as { verdict?: unknown })?.verdict === 'string' ? (value as { verdict: string }).verdict : undefined
// Runs a check and links its window to the returned report object, so a
// report can only ever show the window it was produced in.
export async function measured<T>(
  label: string,
  run: () => Promise<T>,
  o: { verdict?: (value: T) => string | undefined; key?: (value: T) => unknown } = {},
): Promise<T> {
  const key = o.key ?? ((value: T) => value)
  const register = (value: T, network: NetworkWindow) => {
    const target = key(value)
    if (target && typeof target === 'object') windows.set(target, network)
  }
  if (!recorder) {
    const startedAt = Date.now(),
      value = await run()
    register(value, { label, startedAt, endedAt: Date.now(), measured: false, requests: [], requestCount: 0, otherLoads: null })
    return value
  }
  const { value, network } = await recorder.measure(label, run, o.verdict ?? (value => reportVerdict(key(value))))
  register(value, network)
  return value
}
export const networkFor = (value: unknown): NetworkWindow | undefined =>
  value && typeof value === 'object' ? windows.get(value) : undefined
export const readNetworkActivity = (): NetworkActivity => recorder?.read() ?? { requests: [], checks: [] }
export const subscribeNetworkActivity = (listener: () => void): (() => void) => recorder?.subscribe(listener) ?? (() => {})
export const clearNetworkActivity = (): void => recorder?.clear()
export const networkRecorderInstalled = (): boolean => Boolean(recorder)
