import { expect, it } from 'vitest'
import QRCode from 'qrcode'
import { encodeStaticQR, decodeStaticQR } from '../src/handoff/static-qr.ts'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { fromAttendee, invitationFor } from '../src/handoff/evidence.ts'
import { createReceivingRequest } from '../src/handoff/wallet.ts'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'

it('fits complete signed receiving requests and ticket evidence into a lossless static QR', async () => {
  const f = await attendeeOfflineFixture('https://ticketsv.example'),
    ticket = fromAttendee(attendeeEvidence(f.record, f.identity, 'https://ticketsv.example'))
  const wallet = new ProtoWallet(new PrivateKey(3))
  const signer = Object.assign(wallet, { getNetwork: async () => ({ network: 'testnet' as const }) })
  const request = await createReceivingRequest(signer, invitationFor(ticket, 1767665), new AbortController().signal)
  for (const value of [request, ticket.pkg, ticket]) {
    const text = JSON.stringify(value),
      code = encodeStaticQR(text)
    expect(code).toBeTruthy()
    expect(decodeStaticQR(code!)).toBe(text)
    expect(QRCode.create(code!, { errorCorrectionLevel: 'M' }).version).toBeLessThanOrEqual(40)
  }
})
it('uses file fallback for incompressible packages and rejects malformed, damaged and oversized QR input', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12000)),
    value = JSON.stringify({ data: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') })
  expect(encodeStaticQR(value)).toBeNull()
  const code = encodeStaticQR(JSON.stringify({ text: 'hello 🧡' }))!
  expect(decodeStaticQR(code)).toBe(JSON.stringify({ text: 'hello 🧡' }))
  expect(() => decodeStaticQR(code.slice(0, -4) + '0000')).toThrow('Static QR compression checksum does not match.')
  for (const [bad, message] of [
    ['TSV2:000', 'Invalid or oversized static QR.'],
    ['TSV1:A', 'Invalid static QR encoding.'],
    ['TSV1:%%%', 'Invalid static QR encoding.'],
    ['TSV1:ZZZ', 'Invalid static QR encoding.'],
    ['TSV1:' + 'A'.repeat(3400), 'Invalid or oversized static QR.'],
  ])
    expect(() => decodeStaticQR(bad)).toThrow(message)
  expect(() => encodeStaticQR('not json')).toThrow('Unexpected token \'o\', "not json" is not valid JSON')
  expect(() => encodeStaticQR(JSON.stringify({ data: 'x'.repeat(4 * 1024 * 1024) }))).toThrow('Ticket envelope exceeds 4 MiB.')
})
