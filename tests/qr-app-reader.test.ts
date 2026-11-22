import { expect, it, vi } from 'vitest'

// If ZXing cannot start (missing or blocked WASM), scanning says so plainly and
// points to file loading instead of surfacing a low-level error.
vi.mock('../src/qr/decode.ts', () => ({
  prepareQRDecoder: vi.fn(async () => {
    throw Error('wasm streaming compile failed')
  }),
  decodeQRImage: vi.fn(),
}))
it('reports an unavailable reader in plain words', async () => {
  const { prepareAppQRReader, readQR } = await import('../src/qr/app-reader.ts')
  await expect(prepareAppQRReader()).rejects.toThrow('QR reader unavailable. Use a file on this device.')
  await expect(readQR({} as ImageData)).rejects.toThrow('QR reader unavailable. Use a file on this device.')
})
