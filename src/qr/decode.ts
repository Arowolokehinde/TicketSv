import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

// ZXing reads QR codes from camera frames and images. Its WASM always comes
// from the app's own files (or bytes in tests), never a CDN, so reading works
// offline once the app is cached.
export type QRReading = { bytes: Uint8Array; text: string }
type Pixels = { data: Uint8ClampedArray; width: number; height: number }
let prepared: Promise<unknown> | undefined

export function prepareQRDecoder(wasm: { url: string } | { binary: ArrayBuffer | Uint8Array }): Promise<void> {
  prepared ??= prepareZXingModule({
    overrides:
      'url' in wasm
        ? { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.url : prefix + path) }
        : { wasmBinary: wasm.binary instanceof Uint8Array ? wasm.binary.slice().buffer : wasm.binary },
    fireImmediately: true,
  }).catch(error => {
    prepared = undefined
    throw error
  })
  return prepared.then(() => undefined)
}

export async function decodeQRImage(image: Pixels): Promise<QRReading | null> {
  const [found] = await readBarcodes(image as ImageData, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 })
  return found?.isValid ? { bytes: found.bytes, text: found.text } : null
}
