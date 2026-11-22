import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import '../styles/qr-fullscreen.css'

// The QR as large as the screen allows, in whole screen pixels per module, on
// white, with the screen kept awake where the browser allows it. Tap or press
// Escape to close.
export function QRFullScreen({ payload, label, onClose }: { payload: string | Uint8Array; label: string; onClose: () => void }) {
  const [image, setImage] = useState<{ url: string; width: number }>()
  useEffect(() => {
    let active = true
    const segments: QRCode.QRCodeSegment[] = [
      typeof payload === 'string' ? { data: payload, mode: 'alphanumeric' } : { data: payload, mode: 'byte' },
    ]
    const modules = QRCode.create(segments, { errorCorrectionLevel: 'M' }).modules.size + 8
    const ratio = window.devicePixelRatio || 1,
      available = Math.min(innerWidth, innerHeight) - 32
    const scale = Math.max(1, Math.floor((available * ratio) / modules))
    void QRCode.toDataURL(segments, { errorCorrectionLevel: 'M', scale, margin: 4 }).then(url => {
      if (active) setImage({ url, width: (modules * scale) / ratio })
    })
    return () => {
      active = false
    }
  }, [payload])
  useEffect(() => {
    let lock: { release: () => Promise<void> } | undefined,
      open = true
    void navigator.wakeLock
      ?.request('screen')
      .then(value => {
        if (open) lock = value
        else void value.release()
      })
      .catch(() => {
        /* The screen may dim; the QR stays shown. */
      })
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    addEventListener('keydown', escape)
    return () => {
      open = false
      removeEventListener('keydown', escape)
      void lock?.release().catch(() => {})
    }
  }, [onClose])
  return (
    <div className="qr-fullscreen" role="dialog" aria-modal="true" aria-label={`${label} QR, full screen`} onClick={onClose}>
      {image && <img src={image.url} alt={`${label} QR`} style={{ width: image.width, height: image.width }} />}
      <p>Turn the screen brightness up. Tap to close.</p>
    </div>
  )
}
