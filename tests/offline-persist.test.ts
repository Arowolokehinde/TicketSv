import { afterEach, describe, expect, it, vi } from 'vitest'
import { canReopenOffline, keepOfflineData, offlineStorage, storageError } from '../src/offline/persist.ts'

afterEach(() => vi.unstubAllGlobals())
describe('saved data kept on this device', () => {
  it('asks the browser to keep data and reports its answer', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => true, estimate: async () => ({ usage: 2_400_000 }) } })
    expect(await keepOfflineData()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
    expect(await offlineStorage()).toEqual({ kept: true, text: 'Kept on this device · 2.4 MB used' })
  })
  it('never throws when the browser cannot say', async () => {
    vi.stubGlobal('navigator', {})
    expect(await keepOfflineData()).toBeUndefined()
    expect((await offlineStorage()).kept).toBeUndefined()
    vi.stubGlobal('navigator', { storage: { persist: async () => Promise.reject(Error('blocked')), persisted: async () => false } })
    expect(await keepOfflineData()).toBeUndefined()
    expect((await offlineStorage()).kept).toBe(false)
  })
  it('reopens offline only with a service worker on a secure page', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} })
    vi.stubGlobal('isSecureContext', true)
    expect(canReopenOffline()).toBe(true)
    vi.stubGlobal('isSecureContext', false)
    expect(canReopenOffline()).toBe(false)
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', true)
    expect(canReopenOffline()).toBe(false)
  })
})
describe('storage failures', () => {
  it('says plainly when the device is out of space', () => {
    const quota = { name: 'QuotaExceededError' } as DOMException
    expect(storageError(quota, 'Could not save.').message).toBe(
      'This device is out of space; nothing was saved. Free some space before continuing.',
    )
    expect(storageError(null, 'Could not save.').message).toBe('Could not save.')
  })
})
