import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeQRImage, prepareQRDecoder } from '../src/qr/decode.ts'
import { encodeTicketQR } from '../src/handoff/ticket-qr-payload.ts'
import { realTicket } from './helpers/real-ticket.ts'
import { blankFrame, inFrame, renderQR, resize } from './helpers/qr-images.ts'

beforeAll(async () => {
  await prepareQRDecoder({ binary: readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') })
})
const payload = async (value: unknown) => (await encodeTicketQR(JSON.stringify(value))) as Uint8Array

describe('ZXing decode core', () => {
  it('reads the real entrance proof byte for byte', async () => {
    const expected = await payload(realTicket('mined').pkg)
    const reading = await decodeQRImage(inFrame(resize(await renderQR(expected), 380)))
    expect(reading?.bytes).toEqual(expected)
  })
  it('reads the full handoff ticket byte for byte', async () => {
    const expected = await payload(realTicket('mined'))
    const reading = await decodeQRImage(inFrame(resize(await renderQR(expected), 420)))
    expect(reading?.bytes).toEqual(expected)
  })
  it('reads a code held off-centre in the camera frame', async () => {
    const expected = await payload(realTicket('mined').pkg)
    expect((await decodeQRImage(inFrame(resize(await renderQR(expected), 380), 'corner')))?.bytes).toEqual(expected)
  })
  it('returns text readings', async () => {
    expect((await decodeQRImage(inFrame(await renderQR('TSV1:TEST'))))?.text).toBe('TSV1:TEST')
  })
  it('returns null for a blank frame', async () => {
    expect(await decodeQRImage(blankFrame())).toBeNull()
  })
})
