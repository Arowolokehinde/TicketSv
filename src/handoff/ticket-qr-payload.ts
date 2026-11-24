import { Hash, Utils } from '@bsv/sdk'
import { MAX_PACKAGE_BYTES } from '../tickets/codec.ts'
import { encodeStaticQR, decodeStaticQR } from './static-qr.ts'
import { packCompactTicket, unpackCompactTicket } from './compact-ticket.ts'
const MAGIC = new TextEncoder().encode('TSV2:'),
  HEADER = 41,
  MAX_QR_BYTES = 2331
let loaded: Promise<Awaited<(typeof import('brotli-wasm'))['default']>> | undefined
async function brotli() {
  loaded ??= import('brotli-wasm')
    .then(m => m.default)
    .catch(error => {
      loaded = undefined
      throw error
    })
  return loaded
}
export async function prepareTicketQRDecoder(): Promise<void> {
  await brotli()
}
export function isBinaryTicketQR(bytes: Uint8Array): boolean {
  return MAGIC.every((b, i) => bytes[i] === b)
}
export async function encodeTicketQR(text: string): Promise<string | Uint8Array | null> {
  const legacy = encodeStaticQR(text)
  if (legacy !== null) return legacy
  const packed = packCompactTicket(JSON.parse(text))
  if (!packed) return null
  const api = await brotli(),
    compressed = api.compress(packed, { quality: 11 })
  if (HEADER + compressed.length > MAX_QR_BYTES) return null
  const out = new Uint8Array(HEADER + compressed.length)
  out.set(MAGIC)
  new DataView(out.buffer).setUint32(5, packed.length)
  out.set(Hash.sha256(Array.from(packed)), 9)
  out.set(compressed, HEADER)
  return out
}
export async function decodeTicketQR(code: string | Uint8Array): Promise<string> {
  if (typeof code === 'string') return decodeStaticQR(code)
  if (!isBinaryTicketQR(code) || code.length <= HEADER || code.length > MAX_QR_BYTES) throw Error('Invalid or oversized compact QR.')
  const length = new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(5)
  if (!length || length > MAX_PACKAGE_BYTES) throw Error('Compact QR exceeds size limit.')
  const api = await brotli(),
    stream = new api.DecompressStream(),
    parts: Uint8Array[] = []
  let offset = HEADER,
    total = 0,
    finished = false
  try {
    // Streaming with a fixed output budget prevents decompression bombs and
    // rejects truncated/trailing streams rather than accepting partial evidence.
    while (!finished) {
      const result = stream.decompress(code.subarray(offset), Math.min(65536, length - total + 1))
      try {
        const data = result.buf
        offset += result.input_offset
        total += data.length
        if (total > length) throw Error('Compact QR decompressed size mismatch.')
        parts.push(data)
        if (result.code === api.BrotliStreamResultCode.ResultSuccess) {
          finished = true
          if (offset !== code.length) throw Error('Trailing compact QR bytes.')
        } else if (result.code !== api.BrotliStreamResultCode.NeedsMoreOutput || (!data.length && !result.input_offset))
          throw Error('Incomplete compact QR.')
      } finally {
        result.free()
      }
    }
  } finally {
    stream.free()
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  if (total !== length || Utils.toHex(Hash.sha256(Array.from(bytes))) !== Utils.toHex(Array.from(code.subarray(9, HEADER))))
    throw Error('Compact QR checksum mismatch.')
  const text = JSON.stringify(unpackCompactTicket(bytes))
  if (new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES) throw Error('Restored QR exceeds package size limit.')
  return text
}
