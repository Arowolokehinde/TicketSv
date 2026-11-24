import { Hash, Utils } from '@bsv/sdk'
import { zlibSync, unzlibSync } from 'fflate'
import { MAX_PACKAGE_BYTES } from '../tickets/codec.ts'

// Versioned, self-contained optical transport. The original JSON bytes and all
// signatures/proofs survive unchanged; this is never a server lookup token.
const PREFIX = 'TSV1:',
  ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'
const MAX_QR_CHARACTERS = 3391 // Version 40, medium correction, alphanumeric mode.
const HEADER_BYTES = 36 // uncompressed byte length and SHA-256 of the original JSON.
function base45(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 2) {
    let n = i + 1 < bytes.length ? bytes[i] * 256 + bytes[i + 1] : bytes[i]
    result += ALPHABET[n % 45]
    n = Math.floor(n / 45)
    result += ALPHABET[n % 45]
    if (i + 1 < bytes.length) result += ALPHABET[Math.floor(n / 45)]
  }
  return result
}
function unbase45(text: string): Uint8Array {
  if (!text.length || text.length % 3 === 1) throw Error('Invalid static QR encoding.')
  const bytes: number[] = []
  for (let i = 0; i < text.length; i += 3) {
    const count = Math.min(3, text.length - i),
      digits = Array.from(text.slice(i, i + count), c => ALPHABET.indexOf(c))
    if (digits.some(d => d < 0)) throw Error('Invalid static QR encoding.')
    const n = digits[0] + 45 * digits[1] + (count === 3 ? 2025 * digits[2] : 0)
    if (n > (count === 3 ? 65535 : 255)) throw Error('Invalid static QR encoding.')
    if (count === 3) bytes.push(n >> 8, n & 255)
    else bytes.push(n)
  }
  return new Uint8Array(bytes)
}
export function encodeStaticQR(text: string): string | null {
  if (typeof text !== 'string' || text.length > MAX_PACKAGE_BYTES) throw Error('Ticket envelope exceeds 4 MiB.')
  const bytes = new TextEncoder().encode(text)
  if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) throw Error('Ticket envelope exceeds 4 MiB.')
  JSON.parse(text)
  const compressed = zlibSync(bytes, { level: 9 }),
    packed = new Uint8Array(HEADER_BYTES + compressed.length)
  new DataView(packed.buffer).setUint32(0, bytes.length)
  packed.set(Hash.sha256(Array.from(bytes)), 4)
  packed.set(compressed, HEADER_BYTES)
  // Avoid building a large text representation for packages that cannot fit.
  if (PREFIX.length + Math.ceil(packed.length * 1.5) > MAX_QR_CHARACTERS) return null
  return PREFIX + base45(packed)
}
export function decodeStaticQR(code: string): string {
  if (typeof code !== 'string' || !code.startsWith(PREFIX) || code.length > MAX_QR_CHARACTERS)
    throw Error('Invalid or oversized static QR.')
  const packed = unbase45(code.slice(PREFIX.length))
  if (packed.length <= HEADER_BYTES) throw Error('Incomplete static QR.')
  const length = new DataView(packed.buffer).getUint32(0)
  if (!length || length > MAX_PACKAGE_BYTES) throw Error('Static QR exceeds the 4 MiB limit.')
  // A caller-provided output buffer prevents an advertised small size from
  // causing unbounded allocation. One extra byte detects length mismatches.
  const bytes = unzlibSync(packed.subarray(HEADER_BYTES), { out: new Uint8Array(length + 1) })
  if (bytes.length !== length || Utils.toHex(Hash.sha256(Array.from(bytes))) !== Utils.toHex(Array.from(packed.subarray(4, HEADER_BYTES))))
    throw Error('Static QR checksum or length does not match.')
  let a = 1,
    b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  if (new DataView(packed.buffer).getUint32(packed.length - 4) !== ((b << 16) | a) >>> 0)
    throw Error('Static QR compression checksum does not match.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  JSON.parse(text)
  return text
}
