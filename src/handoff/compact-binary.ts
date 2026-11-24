// Deliberately small CBOR subset: definite arrays, bytes, UTF-8, uint32 and null.
// No maps, tags, indefinite lengths or executable object keys.
import { MAX_PACKAGE_BYTES } from '../tickets/codec.ts'
export type BinaryValue = null | number | string | Uint8Array | BinaryValue[]
export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
function head(major: number, n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw Error('Invalid compact integer.')
  if (n < 24) return new Uint8Array([major * 32 + n])
  if (n < 256) return new Uint8Array([major * 32 + 24, n])
  const out = new Uint8Array(n < 65536 ? 3 : 5)
  out[0] = major * 32 + (out.length === 3 ? 25 : 26)
  const view = new DataView(out.buffer)
  if (out.length === 3) view.setUint16(1, n)
  else view.setUint32(1, n)
  return out
}
export function encodeBinary(value: BinaryValue): Uint8Array {
  if (value === null) return new Uint8Array([246])
  if (typeof value === 'number') return head(0, value)
  if (typeof value === 'string') {
    const b = new TextEncoder().encode(value)
    return concat([head(3, b.length), b])
  }
  if (value instanceof Uint8Array) return concat([head(2, value.length), value])
  return concat([head(4, value.length), ...value.map(encodeBinary)])
}
export function decodeBinary(data: Uint8Array): BinaryValue {
  if (!data.length || data.length > MAX_PACKAGE_BYTES) throw Error('Invalid compact package size.')
  let offset = 0,
    nodes = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  function read(depth: number): BinaryValue {
    if (depth > 16 || ++nodes > 4096 || offset >= data.length) throw Error('Invalid compact structure.')
    const tag = data[offset++]
    if (tag === 246) return null
    const major = tag >> 5,
      small = tag & 31
    let size = small
    if (small >= 24) {
      const count = small === 24 ? 1 : small === 25 ? 2 : small === 26 ? 4 : 0
      if (!count || offset + count > data.length) throw Error('Invalid compact length.')
      size = count === 1 ? data[offset] : count === 2 ? view.getUint16(offset) : view.getUint32(offset)
      offset += count
    }
    if (major === 0) return size
    if (major === 2 || major === 3) {
      if (size > data.length - offset) throw Error('Truncated compact value.')
      const value = data.slice(offset, offset + size)
      offset += size
      return major === 2 ? value : new TextDecoder('utf-8', { fatal: true }).decode(value)
    }
    if (major !== 4 || size > 4096 - nodes || size > data.length - offset) throw Error('Invalid compact array.')
    return Array.from({ length: size }, () => read(depth + 1))
  }
  const result = read(0)
  if (offset !== data.length) throw Error('Trailing compact data.')
  return result
}
