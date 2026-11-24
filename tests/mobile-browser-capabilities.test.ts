import { afterEach, expect, it, vi } from 'vitest'
import { offlineAppLimitation, OfflineAppUnavailableError, prepareAttendeeApp } from '../src/offline/attendee-cache.ts'
import { preferredWalletTransport } from '../src/wallet/connection.ts'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it('distinguishes an HTTPS browser without offline support from an insecure page', async () => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', {})
  expect(offlineAppLimitation()).toContain('cannot reopen TicketSV offline')
  expect(offlineAppLimitation()).not.toContain('HTTPS')
  await expect(prepareAttendeeApp(new AbortController().signal)).rejects.toBeInstanceOf(OfflineAppUnavailableError)
  vi.stubGlobal('window', { isSecureContext: false })
  expect(offlineAppLimitation()).toContain('HTTPS')
})
it('requires a usable registration API before reporting app caching support', () => {
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { serviceWorker: undefined })
  expect(offlineAppLimitation()).toBeTruthy()
  vi.stubGlobal('navigator', { serviceWorker: { register: () => {} } })
  expect(offlineAppLimitation()).toBeNull()
})
it('uses the native bridge on mobile and retains an explicitly selected connection', () => {
  vi.stubGlobal('window', { ReactNativeWebView: { postMessage: () => {} } })
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  expect(preferredWalletTransport()).toBe('browser-native')
  vi.stubGlobal('sessionStorage', { getItem: () => 'desktop-https' })
  expect(preferredWalletTransport()).toBe('desktop-https')
  vi.stubGlobal('sessionStorage', { getItem: () => 'browser-native' })
  expect(preferredWalletTransport()).toBe('browser-native')
  vi.stubGlobal('window', {})
  vi.stubGlobal('sessionStorage', { getItem: () => null })
  expect(preferredWalletTransport()).toBe('desktop-http')
})

it('reports missing offline reopening support without registering a worker, fetching, or invoking the wallet', async () => {
  const { readBrowserCompatibility } = await import('../src/offline/browser-compatibility.ts')
  const fetch = vi.fn(),
    postMessage = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('window', { isSecureContext: true, ReactNativeWebView: { postMessage } })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('indexedDB', {})
  vi.stubGlobal('caches', {})
  const result = await readBrowserCompatibility(new AbortController().signal)
  expect(result.secureContext).toBe(true)
  expect(result.nativeWalletBridge).toBe(true)
  expect(result.serviceWorkers).toBe(false)
  expect(result.appFiles).toBe('missing')
  expect(fetch).not.toHaveBeenCalled()
  expect(postMessage).not.toHaveBeenCalled()
})
