import { Hash, Utils } from '@bsv/sdk'
import { fromBase64, MAX_PACKAGE_BYTES } from '../tickets/codec.ts'
const PAYLOAD_BYTES = 1000, MAX_FRAMES = 4096
const hash = (bytes: number[]) => Utils.toHex(Hash.sha256(bytes))
type Frame = { kind: 'ticketsv-handoff-frame'; version: 1; id: string; index: number; count: number; payload: string }
export function encodeFrames(text: string): string[] {
 if (typeof text !== 'string' || text.length > MAX_PACKAGE_BYTES) throw Error('Handoff envelope exceeds 4 MiB.')
 const bytes = [...new TextEncoder().encode(text)]
 if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES || Math.ceil(bytes.length / PAYLOAD_BYTES) > MAX_FRAMES) throw Error('Handoff exceeds exchange size or frame limit.')
 JSON.parse(text)
 const id = hash(bytes), count = Math.ceil(bytes.length / PAYLOAD_BYTES)
 return Array.from({ length: count }, (_, index) => JSON.stringify({ kind: 'ticketsv-handoff-frame', version: 1, id, index, count, payload: Utils.toBase64(bytes.slice(index * PAYLOAD_BYTES, (index + 1) * PAYLOAD_BYTES)) } satisfies Frame))
}
export class FrameAssembler {
 private id?: string
 private count = 0
 private parts = new Map<number, { payload: string; bytes: number[] }>()
 private size = 0
 get received(): number { return this.parts.size }
 get total(): number { return this.count }
 reset(): void { this.id = undefined; this.count = 0; this.parts.clear(); this.size = 0 }
 add(text: string): string | undefined {
  if (typeof text !== 'string' || text.length > 2000) throw Error('Invalid or oversized exchange frame.')
  const f = JSON.parse(text) as Frame
  if (!f || f.kind !== 'ticketsv-handoff-frame' || f.version !== 1 || typeof f.id !== 'string' || !/^[a-f0-9]{64}$/.test(f.id) || !Number.isSafeInteger(f.count) || f.count < 1 || f.count > MAX_FRAMES || !Number.isSafeInteger(f.index) || f.index < 0 || f.index >= f.count) throw Error('Invalid exchange frame.')
  const bytes = fromBase64(f.payload, PAYLOAD_BYTES)
  if (this.id !== undefined && (this.id !== f.id || this.count !== f.count)) throw Error('Mixed handoff frames; reset before scanning another exchange.')
  const existing = this.parts.get(f.index)
  if (existing && existing.payload !== f.payload) throw Error('Conflicting duplicate exchange frame.')
  if (!existing) {
   if (this.size + bytes.length > MAX_PACKAGE_BYTES) throw Error('Handoff envelope exceeds 4 MiB.')
   this.id = f.id; this.count = f.count; this.parts.set(f.index, { payload: f.payload, bytes }); this.size += bytes.length
  }
  if (this.parts.size !== this.count) return undefined
  const assembled: number[] = []
  for (let i = 0; i < this.count; i++) assembled.push(...this.parts.get(i)!.bytes)
  if (hash(assembled) !== this.id) throw Error('Handoff frame checksum failed.')
  const result = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(assembled))
  JSON.parse(result)
  return result
 }
}
