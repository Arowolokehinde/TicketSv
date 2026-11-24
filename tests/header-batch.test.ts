import { expect, it, vi } from 'vitest'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import b from './fixtures/headers/woc-1762325.json' with { type: 'json' }
import { parseProviderHeader } from '../src/headers/validate.ts'
import { checkHeaderRange, decodeHeaderBatch } from '../src/headers/batch.ts'
import { collectHeaderRange } from '../server/header-sources.ts'
const records = [a, b].map(h => parseProviderHeader(h, 'whatsonchain', h.height))
const bytes = Uint8Array.from(Buffer.from(records.map(h => h.hex).join(''), 'hex'))
it('decodes real binary headers and rejects truncation, invalid work and excessive ranges', () => {
  expect(decodeHeaderBatch(bytes, a.height, 2)).toEqual(records)
  expect(() => decodeHeaderBatch(bytes.slice(1), a.height, 2)).toThrow('Header batch length does not match its requested range.')
  expect(() => decodeHeaderBatch(new Uint8Array(160), a.height, 2)).toThrow('Invalid compact target')
  expect(() => decodeHeaderBatch(bytes, a.height, 513)).toThrow('Invalid header batch range.')
})
function upstream(alter?: (url: string) => Response | undefined) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input),
      changed = alter?.(url)
    if (changed) return changed
    if (url.endsWith('/network')) return Response.json({ status: 'success', value: 'test' })
    if (url.endsWith('/resources'))
      return Response.json({ files: [`https://api.whatsonchain.com/v1/bsv/test/block/headers/${a.height}_${b.height}_headers.bin`] })
    return new Response(bytes)
  }) as unknown as typeof fetch
}
it('compares the entire range from independent bulk sources', async () => {
  const get = upstream()
  expect(await collectHeaderRange(a.height, 2, new AbortController().signal, get)).toEqual(records)
  expect(get).toHaveBeenCalledTimes(4)
})
it('rejects disagreement, wrong network and untrusted resource URLs', async () => {
  for (const mutate of [
    (u: string) => (u.includes('chaintracks') && u.includes('/headers?') ? new Response(new Uint8Array(160)) : undefined),
    (u: string) => (u.endsWith('/network') ? Response.json({ status: 'success', value: 'main' }) : undefined),
    (u: string) => (u.endsWith('/resources') ? Response.json({ files: ['http://127.0.0.1/private'] }) : undefined),
  ])
    await expect(collectHeaderRange(a.height, 2, new AbortController().signal, upstream(mutate))).rejects.toThrow()
})
it('does not fetch when aborted and bounds bodies even without content length', async () => {
  const get = upstream(),
    abort = new AbortController()
  abort.abort(Error('cancelled'))
  await expect(collectHeaderRange(a.height, 2, abort.signal, get)).rejects.toThrow('cancelled')
  expect(get).not.toHaveBeenCalled()
  const large = upstream(u => (u.endsWith('/resources') ? new Response(' '.repeat(100001)) : undefined))
  await expect(collectHeaderRange(a.height, 2, new AbortController().signal, large)).rejects.toThrow(/size|large/i)
})
it('cancels and settles sibling response bodies when an upstream fails', async () => {
  let cancelled = false
  const get = vi.fn(async input =>
    String(input).endsWith('/network')
      ? new Response('', { status: 503 })
      : new Response(
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
        ),
  ) as unknown as typeof fetch
  await expect(collectHeaderRange(a.height, 2, new AbortController().signal, get)).rejects.toThrow(/503/)
  expect(cancelled).toBe(true)
})

it('retries a source request refused with 429 after a pause instead of failing the round', async () => {
  let refusals = 2
  const get = upstream(u => (u.endsWith('/resources') && refusals-- > 0 ? new Response('', { status: 429 }) : undefined)),
    waits: number[] = []
  expect(
    await collectHeaderRange(a.height, 2, new AbortController().signal, get, undefined, async ms => {
      waits.push(ms)
    }),
  ).toEqual(records)
  expect(waits).toEqual([1000, 2000])
  expect(get).toHaveBeenCalledTimes(6)
})
it('honours a bounded Retry-After and gives up after four attempts', async () => {
  const refused = () => new Response('', { status: 429, headers: { 'Retry-After': '30' } })
  const get = upstream(u => (u.endsWith('/resources') ? refused() : undefined)),
    waits: number[] = []
  await expect(
    collectHeaderRange(a.height, 2, new AbortController().signal, get, undefined, async ms => {
      waits.push(ms)
    }),
  ).rejects.toThrow(/429/)
  expect(waits).toEqual([5000, 5000, 5000])
})
it('does not retry other upstream failures', async () => {
  const get = upstream(u => (u.endsWith('/resources') ? new Response('', { status: 503 }) : undefined)),
    waits: number[] = []
  await expect(
    collectHeaderRange(a.height, 2, new AbortController().signal, get, undefined, async ms => {
      waits.push(ms)
    }),
  ).rejects.toThrow(/503/)
  expect(waits).toEqual([])
})

it('accepts the handoff mining range beyond the old experiment ceiling', () => {
  expect(() => checkHeaderRange(1766361, 105)).not.toThrow()
})

it('keeps height arithmetic and per-request work bounded without a lifetime ceiling', () => {
  for (const [start, count] of [
    [NaN, 1],
    [1766465, 0],
    [1766465, 513],
    [2147483647, 2],
    [1762323, 1],
    [1766465, 1.5],
  ])
    expect(() => checkHeaderRange(start, count)).toThrow('Invalid header batch range.')
})
