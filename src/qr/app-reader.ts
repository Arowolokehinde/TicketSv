import zxingWasm from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { decodeQRImage, prepareQRDecoder, type QRReading } from './decode.ts'

// The app's QR reader, with ZXing's WASM served from the app's own files.
export function prepareAppQRReader(): Promise<void> {
  return prepareQRDecoder({ url: zxingWasm }).catch(() => {
    throw Error('QR reader unavailable. Use a file on this device.')
  })
}
export async function readQR(image: ImageData): Promise<QRReading | null> {
  await prepareAppQRReader()
  return decodeQRImage(image)
}
