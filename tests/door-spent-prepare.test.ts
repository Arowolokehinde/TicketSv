import { describe, expect, it } from 'vitest'
import { prepareSpentList } from '../src/scanner/prepare-spent.ts'
import type { SpentList } from '../src/scanner/spent.ts'
import type { RecordStore } from '../src/handoff/types.ts'
import { conflictFixture } from './helpers/conflict-fixture.ts'

function memory(initial?: SpentList) {
  let r = initial
  return {
    load: async () => r,
    list: async () => (r ? [r] : []),
    remove: async () => {},
    save: async (n: SpentList, rev?: number) => {
      if (rev !== r?.revision) throw Error('Changed')
      r = n
    },
    value: () => r,
  } satisfies RecordStore<SpentList> & { value: () => SpentList | undefined }
}
const signal = () => new AbortController().signal
const walked = { checkedAt: '2026-11-19T18:40:00.000Z', tickets: ['aa'.repeat(32) + '.0'], spent: [] }

describe('spent list preparation', () => {
  it("walks the organiser's complete tickets and saves the list", async () => {
    const f = await conflictFixture(),
      store = memory(),
      seen: unknown[] = []
    const issuances = [
      { status: 'complete', pkg: f.base },
      { status: 'pending', pkg: null },
    ]
    const list = await prepareSpentList('conflict-event', signal(), undefined, {
      api: async <T>(path: string) => {
        expect(path).toBe('/api/events/conflict-event/issuances')
        return { issuances } as T
      },
      store,
      walk: async (eventId, packages) => {
        seen.push(eventId, packages.length)
        return walked
      },
    })
    expect(seen).toEqual(['conflict-event', 1])
    expect(list).toEqual({ id: 'conflict-event', revision: 0, ...walked })
    expect(store.value()).toEqual(list)
  })
  it('replaces an earlier list for the event', async () => {
    const store = memory({ id: 'conflict-event', revision: 3, checkedAt: walked.checkedAt, tickets: [], spent: [] })
    const list = await prepareSpentList('conflict-event', signal(), undefined, {
      api: async <T>() => ({ issuances: [] }) as T,
      store,
      walk: async () => walked,
    })
    expect(list?.revision).toBe(4)
  })
  it("saves no list for an account that isn't the event's organiser", async () => {
    const store = memory()
    const list = await prepareSpentList('conflict-event', signal(), undefined, {
      api: async () => {
        throw Object.assign(Error('Event not found.'), { status: 404 })
      },
      store,
      walk: async () => walked,
    })
    expect(list).toBeUndefined()
    expect(store.value()).toBeUndefined()
  })
  it('fails preparation, keeping the earlier list, when the walk fails', async () => {
    const earlier = { id: 'conflict-event', revision: 0, checkedAt: walked.checkedAt, tickets: [], spent: [] },
      store = memory(earlier)
    await expect(
      prepareSpentList('conflict-event', signal(), undefined, {
        api: async <T>() => ({ issuances: [] }) as T,
        store,
        walk: async () => {
          throw Error('Spend check failed (HTTP 500).')
        },
      }),
    ).rejects.toThrow('HTTP 500')
    expect(store.value()).toBe(earlier)
  })
})
