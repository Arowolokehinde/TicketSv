import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { encodeTicketQR, decodeTicketQR } from '../src/handoff/ticket-qr-payload.ts'
import { verifyHandoffTicket } from '../src/handoff/evidence.ts'
it.skipIf(!process.env.TICKETSV_QR_TEST_FILE)('round-trips the supplied local ticket without altering any evidence', async () => {
  const value = JSON.parse(await readFile(process.env.TICKETSV_QR_TEST_FILE!, 'utf8')),
    code = await encodeTicketQR(JSON.stringify(value))
  expect(code).toBeInstanceOf(Uint8Array)
  expect(code!.length).toBeLessThanOrEqual(2331)
  const restored = JSON.parse(await decodeTicketQR(code!))
  expect(restored).toEqual(value)
  expect((await verifyHandoffTicket(restored)).checks).toEqual((await verifyHandoffTicket(value)).checks)
})
