import { readFileSync } from 'node:fs'
import { decodeHeaderBatch } from '../../src/headers/batch.ts'
import { makeSnapshot, type HeaderRecord, type HeaderSnapshot } from '../../src/headers/validate.ts'
import { readHandoffTicket } from '../../src/handoff/evidence.ts'
import type { HandoffTicket } from '../../src/handoff/types.ts'

// Real testnet data, unaltered (see tests/fixtures/real/README.md): one
// B-to-C transfer saved before and after mining, and the real block headers
// from the pinned checkpoint through its mining block.
export const REAL_TRANSFER_TXID = 'bb7ce48acd35109a02d28187e3e04ba1a74ae73192fd5a580b71d123b2ee34bc'
export const REAL_MINED_HEIGHT = 1768820
const CHECKPOINT_HEIGHT = 1762324
let records: HeaderRecord[] | undefined
function headerRecords(): HeaderRecord[] {
  if (records) return records
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/real/headers-1762324-1768820.bin', import.meta.url))),
    count = bytes.length / 80
  records = []
  for (let offset = 0; offset < count; offset += 512)
    records.push(
      ...decodeHeaderBatch(
        bytes.subarray(offset * 80, Math.min(count, offset + 512) * 80),
        CHECKPOINT_HEIGHT + offset,
        Math.min(512, count - offset),
      ),
    )
  return records
}
export function realSnapshot(through = REAL_MINED_HEIGHT): HeaderSnapshot {
  return makeSnapshot(
    headerRecords().filter(header => header.height <= through),
    '2026-11-18T00:00:00.000Z',
  )
}
export function realTicket(state: 'mined' | 'unmined'): HandoffTicket {
  return readHandoffTicket(JSON.parse(readFileSync(new URL(`../fixtures/real/handoff-${state}.json`, import.meta.url), 'utf8')))
}
