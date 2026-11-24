import { expect, it } from 'vitest'
import { encodeTicketQR, decodeTicketQR } from '../src/handoff/ticket-qr-payload.ts'
import { decodeStaticQR } from '../src/handoff/static-qr.ts'
it('keeps the original static format for small payloads and supports its decoder', async () => {
  const text = JSON.stringify({ request: 'hello' }),
    code = await encodeTicketQR(text)
  expect(typeof code).toBe('string')
  expect(decodeStaticQR(code as string)).toBe(text)
  expect(await decodeTicketQR(code!)).toBe(text)
})
it('round-trips complete ticket evidence through the binary QR envelope and rejects tampering', async () => {
  const { compactTicketFixture } = await import('./helpers/compact-ticket-fixture.ts'),
    { transfer: value } = await compactTicketFixture(),
    text = JSON.stringify(value)
  const code = await encodeTicketQR(text)
  expect(code).toBeInstanceOf(Uint8Array)
  expect(code!.length).toBeLessThanOrEqual(2331)
  expect(JSON.parse(await decodeTicketQR(code!))).toEqual(value)
  const damaged = (code as Uint8Array).slice()
  damaged[10] ^= 1
  await expect(decodeTicketQR(damaged)).rejects.toThrow('Compact QR checksum mismatch.')
  const short = (code as Uint8Array).slice()
  new DataView(short.buffer).setUint32(5, 1)
  await expect(decodeTicketQR(short)).rejects.toThrow('Compact QR decompressed size mismatch.')
  await expect(decodeTicketQR((code as Uint8Array).slice(0, -3))).rejects.toThrow('Incomplete compact QR.')

  await expect(decodeTicketQR(new Uint8Array([84, 83, 86, 50, 58]))).rejects.toThrow('Invalid or oversized compact QR.')
})
