import { CHECKPOINT, validHeaderHeight } from './checkpoint.ts'
import { validateHeader, type HeaderRecord } from './validate.ts'
export const HEADER_BATCH_SIZE = 512
export const CACHE_SOURCE = 'ticketsv-cache' as const
export function checkHeaderRange(start: number, count: number): void {
 if (!validHeaderHeight(start) || !Number.isSafeInteger(count) || count < 1 || count > HEADER_BATCH_SIZE || !validHeaderHeight(start + count - 1)) throw Error('Invalid header batch range.')
}
export function decodeHeaderBatch(bytes: Uint8Array, start: number, count: number): HeaderRecord[] {
 checkHeaderRange(start, count)
 if (bytes.length !== count * 80) throw Error('Header batch length does not match its requested range.')
 const records: HeaderRecord[] = []
 for (let i = 0; i < count; i++) {
  const hex = Array.from(bytes.subarray(i * 80, (i + 1) * 80), b => b.toString(16).padStart(2, '0')).join('')
  const parsed = validateHeader(hex)
  if (i && parsed.previousHash !== records[i - 1].hash) throw Error('Header batch linkage conflict.')
  if (start + i === CHECKPOINT.height && parsed.hash !== CHECKPOINT.hash) throw Error('Header batch checkpoint conflict.')
  records.push({ height: start + i, hash: parsed.hash, hex })
 }
 return records
}
export { boundedBytes } from '../http/bounded-bytes.ts'
