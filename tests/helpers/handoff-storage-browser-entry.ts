export * from '../../src/handoff/store.ts'
export * from '../../src/handoff/evidence.ts'
export * from '../../src/handoff/transport.ts'
export { default as QRCode } from 'qrcode'
import jsQRModule, { type QRCode as DecodedQR, type Options } from 'jsqr'
export const decodeQR = jsQRModule as unknown as (data: Uint8ClampedArray, width: number, height: number, options?: Options) => DecodedQR | null
