import { api } from '../auth/api.ts'
import { spentListStore } from './store.ts'
import { walkTickets, type SpentList } from './spent.ts'
import type { RecordStore } from '../handoff/types.ts'
import type { VenueIssuance } from '../events/issuance-types.ts'

type Deps = { api: typeof api; store: RecordStore<SpentList>; walk: typeof walkTickets }
// Only the event's organiser can list its tickets. Any other scanner account gets
// no list, so offline it refuses tickets it cannot check.
export async function prepareSpentList(
  eventId: string,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  deps: Deps = { api, store: spentListStore, walk: walkTickets },
): Promise<SpentList | undefined> {
  let issuances: VenueIssuance[]
  try {
    ;({ issuances } = await deps.api<{ issuances: VenueIssuance[] }>(`/api/events/${encodeURIComponent(eventId)}/issuances`, { signal }))
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined
    throw error
  }
  if (!Array.isArray(issuances)) throw Error('Invalid ticket list.')
  const packages = issuances.flatMap(i => (i?.status === 'complete' && i.pkg ? [i.pkg] : []))
  const walked = await deps.walk(eventId, packages, signal, onProgress)
  signal.throwIfAborted()
  const old = await deps.store.load(eventId),
    list: SpentList = { id: eventId, revision: old ? old.revision + 1 : 0, ...walked }
  await deps.store.save(list, old?.revision)
  return list
}
