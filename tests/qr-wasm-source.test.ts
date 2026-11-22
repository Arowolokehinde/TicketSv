import { expect, it, vi } from 'vitest'

// ZXing's default would fetch its WASM from a CDN. The app must always point
// it at its own file, so scanning works offline from the app cache.
const prepare = vi.fn(async (_options: unknown) => ({}))
vi.mock('zxing-wasm/reader', () => ({ prepareZXingModule: prepare, readBarcodes: vi.fn() }))
it('loads the reader WASM from the app, never the package CDN', async () => {
  const { prepareQRDecoder } = await import('../src/qr/decode.ts')
  await prepareQRDecoder({ url: '/assets/zxing_reader-abc.wasm' })
  const { overrides } = prepare.mock.calls[0][0] as { overrides: { locateFile: (path: string, prefix: string) => string } }
  expect(overrides.locateFile('zxing_reader.wasm', 'https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.7/dist/reader/')).toBe(
    '/assets/zxing_reader-abc.wasm',
  )
})
