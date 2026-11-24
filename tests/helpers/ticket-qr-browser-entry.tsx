import { createRoot } from 'react-dom/client'
import App from '../../src/App.tsx'
import jsQRModule, { type QRCode, type Options } from 'jsqr'
const jsQR = jsQRModule as unknown as (data: Uint8ClampedArray, width: number, height: number, options?: Options) => QRCode | null
export { attendeeEvidence } from '../../src/offline/attendee-evidence.ts'
export { saveAttendeeTicket } from '../../src/offline/attendee-store.ts'
export { saveSnapshot } from '../../src/headers/store.ts'
export function mount() {
  createRoot(document.getElementById('root')!).render(<App />)
}
export function readFrame() {
  const img = document.querySelector<HTMLImageElement>('dialog img')!
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(frame.data, frame.width, frame.height)?.data
}
