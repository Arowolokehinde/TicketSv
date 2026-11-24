import { expect, it, vi } from 'vitest'
import type { ListOutputsResult, WalletOutput } from '@bsv/sdk'
import { inspectTicketWalletRecord, listBasket, type ExpectedTicketRecord } from '../src/wallet/ticket-record.ts'
const expected: ExpectedTicketRecord = {
  outpoint: `${'ab'.repeat(32)}.0`,
  satoshis: 1,
  lockingScript: '51',
  key: { protocolID: [2, 'ticketsv test'], keyID: 'request-1', counterparty: 'self' },
}
const record: WalletOutput = {
  outpoint: expected.outpoint,
  satoshis: 1,
  spendable: true,
  customInstructions: JSON.stringify({ type: 'PushDrop', ...expected.key }),
}
it('recognises exact metadata without scripts, BEEF or wallet mutations', async () => {
  const read = vi.fn(async () => ({ totalOutputs: 1, outputs: [record] }))
  expect((await inspectTicketWalletRecord(read, expected)).state).toBe('present')
  expect(read).toHaveBeenCalledWith({ basket: 'ticketsv-tickets', includeCustomInstructions: true, limit: 1000, offset: 0 })
})
it.each([
  { outpoint: `${'cd'.repeat(32)}.0`, state: 'absent' },
  { outpoint: `${'ab'.repeat(32)}.1`, state: 'absent' },
  { satoshis: 2, state: 'inconclusive' },
  { spendable: false, state: 'inconclusive' },
  { customInstructions: undefined, state: 'inconclusive' },
  { customInstructions: 'not JSON', state: 'inconclusive' },
  { customInstructions: JSON.stringify({ type: 'PushDrop', ...expected.key, keyID: 'another-request' }), state: 'inconclusive' },
  { customInstructions: JSON.stringify({ type: 'PushDrop', ...expected.key, counterparty: 'anyone' }), state: 'inconclusive' },
  { customInstructions: JSON.stringify({ type: 'PushDrop', ...expected.key, protocolID: [2, 'another protocol'] }), state: 'inconclusive' },
  { lockingScript: '52', state: 'inconclusive' },
  { lockingScript: 'xyz', state: 'inconclusive' },
])('matches output and instructions conservatively: %j', async ({ state, ...patch }) => {
  const result = await inspectTicketWalletRecord(async () => ({ totalOutputs: 1, outputs: [{ ...record, ...patch }] }), expected)
  expect(result.state).toBe(state)
})
it('pages a capped response before confirming absence or finding the target', async () => {
  const unrelated = { ...record, outpoint: `${'cd'.repeat(32)}.0` }
  const read = vi.fn(async (args: { offset?: number }) => ({ totalOutputs: 2, outputs: [args.offset === 0 ? unrelated : record] }))
  expect((await inspectTicketWalletRecord(read, expected)).state).toBe('present')
  expect(read.mock.calls.map(c => c[0].offset)).toEqual([0, 1])
  const absent = await inspectTicketWalletRecord(
    async args => ({ totalOutputs: 2, outputs: [{ ...unrelated, outpoint: `${'cd'.repeat(32)}.${args.offset}` }] }),
    expected,
  )
  expect(absent.state).toBe('absent')
})
it.each([
  { totalOutputs: 1, outputs: [] },
  { totalOutputs: 1001, outputs: [] },
  { totalOutputs: 0, outputs: [record] },
  { totalOutputs: 2, outputs: [record, record] },
  { totalOutputs: 1, outputs: [{ outpoint: record.outpoint }] },
  { totalOutputs: 1, outputs: [{ ...record, satoshis: 1.5 }] },
])('does not infer presence or absence from a malformed or incomplete page: %j', async listing => {
  expect((await inspectTicketWalletRecord(async () => listing as ListOutputsResult, expected)).state).toBe('inconclusive')
})
it('rejects changing totals and duplicate outputs across pages', async () => {
  const unrelated = { ...record, outpoint: `${'cd'.repeat(32)}.0` }
  expect(
    (await inspectTicketWalletRecord(async args => ({ totalOutputs: args.offset === 0 ? 2 : 3, outputs: [unrelated] }), expected)).state,
  ).toBe('inconclusive')
  expect((await inspectTicketWalletRecord(async () => ({ totalOutputs: 2, outputs: [unrelated] }), expected)).state).toBe('inconclusive')
})
it('propagates read failures so callers preserve cancellation and account guards', async () => {
  await expect(
    inspectTicketWalletRecord(async () => {
      throw Error('Cancelled')
    }, expected),
  ).rejects.toThrow('Cancelled')
})
it('listBasket pages the named basket', async () => {
  const other = { ...record, outpoint: `${'cd'.repeat(32)}.0` }
  const read = vi.fn(async (args: { offset?: number }) => ({ totalOutputs: 2, outputs: [args.offset === 0 ? record : other] }))
  expect((await listBasket(read, 'ticketsv-handoff-fees'))?.map(o => o.outpoint)).toEqual([record.outpoint, other.outpoint])
  expect(read).toHaveBeenCalledWith({ basket: 'ticketsv-handoff-fees', includeCustomInstructions: true, limit: 1000, offset: 0 })
})
it.each([
  { totalOutputs: 1001, outputs: [record] },
  { totalOutputs: 2, outputs: [record, record] },
  { totalOutputs: 1, outputs: [{ ...record, spendable: 'yes' }] },
])('listBasket returns undefined for over-bound or malformed listings', async listing => {
  expect(await listBasket(async () => listing as ListOutputsResult, 'ticketsv-tickets')).toBeUndefined()
})
