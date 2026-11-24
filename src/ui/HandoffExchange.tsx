import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { DashboardIcon } from './DashboardIcon.tsx'
import { QRFullScreen } from './QRFullScreen.tsx'
import QRCode from 'qrcode'
import { prepareAppQRReader, readQR } from '../qr/app-reader.ts'
import { FrameAssembler } from '../handoff/transport.ts'
import { encodeTicketQR, decodeTicketQR, isBinaryTicketQR, prepareTicketQRDecoder } from '../handoff/ticket-qr-payload.ts'
import { MAX_PACKAGE_BYTES } from '../tickets/codec.ts'
export function ExchangeExport({
  value,
  name,
  qrOnly = false,
  initiallyOpen = false,
}: {
  value: unknown
  name: string
  qrOnly?: boolean
  initiallyOpen?: boolean
}) {
  const [show, setShow] = useState(initiallyOpen),
    [url, setUrl] = useState(''),
    [fallback, setFallback] = useState(false),
    [error, setError] = useState(''),
    [imageWidth, setImageWidth] = useState(320),
    [code, setCode] = useState<string | Uint8Array>(),
    [full, setFull] = useState(false)
  const qrContainer = useRef<HTMLDivElement>(null)
  const text = JSON.stringify(value)
  useEffect(() => {
    setShow(initiallyOpen)
    setUrl('')
    setFallback(false)
    setError('')
  }, [text, initiallyOpen])
  useEffect(() => {
    let active = true,
      painting = 0,
      payload: string | Uint8Array | null = null
    setUrl('')
    setFallback(false)
    setError('')
    async function paint() {
      if (!active || payload === null) return
      const generation = ++painting
      const segments: QRCode.QRCodeSegment[] = [
        typeof payload === 'string' ? { data: payload, mode: 'alphanumeric' } : { data: payload, mode: 'byte' },
      ]
      const modules = QRCode.create(segments, { errorCorrectionLevel: 'M' }).modules.size + 8
      const ratio = window.devicePixelRatio || 1,
        available = Math.min(360, qrContainer.current?.clientWidth || 360)
      const scale = Math.max(1, Math.floor((available * ratio) / modules)),
        width = (modules * scale) / ratio
      const image = await QRCode.toDataURL(segments, { errorCorrectionLevel: 'M', scale, margin: 4 })
      if (active && generation === painting) {
        setImageWidth(width)
        setUrl(image)
      }
    }
    const render = () => {
      void paint().catch(e => {
        if (active) setError((e as Error).message)
      })
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(render) : undefined
    if (show) {
      if (qrContainer.current) observer?.observe(qrContainer.current)
      addEventListener('resize', render)
      void encodeTicketQR(text)
        .then(code => {
          if (!active) return
          payload = code
          setCode(code ?? undefined)
          if (code === null) setFallback(true)
          else render()
        })
        .catch(e => {
          if (active) setError((e as Error).message)
        })
    }
    return () => {
      active = false
      observer?.disconnect()
      removeEventListener('resize', render)
    }
  }, [text, show])

  function download() {
    const blob = new Blob([text], { type: 'application/json' }),
      link = document.createElement('a'),
      u = URL.createObjectURL(blob)
    link.href = u
    link.download = `ticketsv-${name}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(u), 1000)
  }
  const close = useCallback(() => setFull(false), [])
  function saveQR() {
    const link = document.createElement('a')
    link.href = url
    link.download = `ticketsv-${name}-qr.png`
    link.click()
  }
  return (
    <div className="handoff-exchange">
      {!qrOnly && (
        <div className="actions">
          <button className="btn" onClick={download}>
            Save {name} file
          </button>
          <button className="btn" onClick={() => setShow(v => !v)}>
            {show ? 'Hide' : 'Show'} {name} QR
          </button>
        </div>
      )}
      {show && (
        <div className="handoff-qr" ref={qrContainer}>
          {url && (
            <>
              <img
                src={url}
                style={{ width: imageWidth, height: imageWidth, maxWidth: 'none', imageRendering: 'pixelated' }}
                alt={`${name} QR`}
              />
              <p>Scan once, or save this QR image to share later.</p>
              <div className="actions">
                <button className="btn primary" onClick={() => setFull(true)}>
                  Show to scanner
                </button>
                <button className="btn" onClick={saveQR}>
                  Save QR image
                </button>
              </div>
            </>
          )}
          {!url && !fallback && !error && <p role="status">Preparing QR…</p>}
          {fallback && (
            <>
              <p role="status">This package is too large for one QR code. Share its complete file instead.</p>
              {qrOnly && (
                <button className="btn" onClick={download}>
                  Save {name} file
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {full && code && <QRFullScreen payload={code} label={name} onClose={close} />}
    </div>
  )
}
// scanFirst: the camera is the main way in, and a file is the fallback.
export function ExchangeImport({
  label,
  onLoad,
  disabled = false,
  scanFirst = false,
}: {
  label: string
  onLoad: (value: unknown) => void | Promise<void>
  disabled?: boolean
  scanFirst?: boolean
}) {
  const fileInput = useRef<HTMLInputElement>(null),
    fileId = useId()
  const [fileName, setFileName] = useState('No file chosen')
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | undefined>(undefined),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    frameRequest = useRef<number | undefined>(undefined),
    assembler = useRef(new FrameAssembler()),
    active = useRef(true)
  const [scanning, setScanning] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('')
  function stop() {
    generation.current++
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = undefined
    clearTimeout(timer.current)
    if (frameRequest.current !== undefined && video.current?.cancelVideoFrameCallback)
      video.current.cancelVideoFrameCallback(frameRequest.current)
    frameRequest.current = undefined
    if (video.current) video.current.srcObject = null
    if (active.current) setScanning(false)
  }
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      stop()
    }
  }, [])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled])
  // Warm the bundled decoder while online, including wallet browsers without a service worker.
  useEffect(() => {
    const warm = () => {
      if (navigator.onLine) {
        void prepareTicketQRDecoder().catch(() => {
          /* Legacy QR/file import still works; a compact scan reports load failures. */
        })
        void prepareAppQRReader().catch(() => {
          /* Scanning reports the failure; file import still works. */
        })
      }
    }
    warm()
    addEventListener('online', warm)
    return () => removeEventListener('online', warm)
  }, [])
  function chooseFile() {
    if (disabled || scanning || !fileInput.current) return
    setError('')
    try {
      // Keep the native picker call synchronous with this explicit user click.
      // No promises, wallet checks or other work may consume user activation first.
      if (typeof fileInput.current.showPicker === 'function') fileInput.current.showPicker()
      else fileInput.current.click()
    } catch (error) {
      setError(
        `The browser could not open the local file chooser: ${error instanceof Error ? error.message : 'try again from Choose File.'}`,
      )
    }
  }
  async function accept(text: string) {
    if (new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES) throw Error('This file exceeds 4 MiB.')
    await onLoad(JSON.parse(text))
  }
  async function scan() {
    stop()
    assembler.current.reset()
    setError('')
    setProgress('')
    setScanning(true)
    const session = generation.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera access is unavailable. Use a file on this device.')
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        },
        audio: false,
      })
      if (!active.current || session !== generation.current) {
        media.getTracks().forEach(t => t.stop())
        return
      }
      stream.current = media
      const v = video.current!
      v.srcObject = media
      await v.play()
      setProgress('Camera ready. Centre the full TicketSV QR and hold the phone steady until it is sharp.')
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const tick = async () => {
        if (!active.current || session !== generation.current) return
        try {
          if (v.readyState >= 2 && v.videoWidth && v.videoHeight) {
            // Dense single-frame tickets need their original camera pixels. Shrinking
            // HD video to 960px can merge QR modules; enlarging that view cannot
            // reliably recover them. Bound full-frame work, then try a native crop.
            const scale = Math.min(1, 1920 / v.videoWidth)
            canvas.width = Math.floor(v.videoWidth * scale)
            canvas.height = Math.floor(v.videoHeight * scale)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            let image = ctx.getImageData(0, 0, canvas.width, canvas.height),
              code = await readQR(image)
            if (!active.current || session !== generation.current) return
            if (!code) {
              const side = Math.min(v.videoWidth, v.videoHeight, 1280)
              canvas.width = side
              canvas.height = side
              ctx.drawImage(v, Math.floor((v.videoWidth - side) / 2), Math.floor((v.videoHeight - side) / 2), side, side, 0, 0, side, side)
              image = ctx.getImageData(0, 0, side, side)
              code = await readQR(image)
              if (!active.current || session !== generation.current) return
            }
            if (code) {
              const binary = code.bytes,
                single = isBinaryTicketQR(binary) || code.text.startsWith('TSV')
              let frame = false
              // Camera decoders can return empty or partial text while focusing. Only
              // complete legacy frame JSON belongs in the assembler; unrelated QR codes
              // and incomplete readings must not stop the camera with a JSON exception.
              if (!single)
                try {
                  frame = JSON.parse(code.text)?.kind === 'ticketsv-handoff-frame'
                } catch {
                  /* Keep looking for a complete TicketSV QR. */
                }
              if (single || frame) {
                const text = single ? await decodeTicketQR(isBinaryTicketQR(binary) ? binary : code.text) : assembler.current.add(code.text)
                if (!active.current || session !== generation.current) return
                setProgress(single ? 'QR received' : `${assembler.current.received} of ${assembler.current.total} frames received`)
                if (text) {
                  stop()
                  await accept(text)
                  return
                }
              } else setProgress('Keep the TicketSV QR centred and steady in the camera.')
            }
          }
          // ZXing decodes a frame in about 20 ms, so check each fresh camera frame as
          // soon as the previous one is done. One decode runs at a time; frames that
          // arrive meanwhile are skipped, never queued.
          if (v.srcObject && v.requestVideoFrameCallback) frameRequest.current = v.requestVideoFrameCallback(() => void tick())
          else timer.current = setTimeout(() => void tick(), 40)
        } catch (e) {
          stop()
          if (active.current) setError((e as Error).message)
        }
      }
      if (session === generation.current) void tick()
    } catch (e) {
      stop()
      if (active.current) setError((e as Error).message)
    }
  }
  const fileBox = (
    <div className="handoff-file">
      <label htmlFor={fileId} className="handoff-file-title">
        <DashboardIcon name="receive" />
        Load {label} file
      </label>
      <input
        id={fileId}
        ref={fileInput}
        style={{ display: 'none' }}
        aria-label={`Load ${label} file`}
        type="file"
        accept="application/json,.json"
        disabled={disabled || scanning}
        onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setFileName(file.name)
          setError('')
          try {
            if (file.size > MAX_PACKAGE_BYTES) throw Error('This file exceeds 4 MiB.')
            await accept(await file.text())
          } catch (e) {
            if (active.current) setError((e as Error).message)
          }
        }}
      />
      <div className="handoff-file-choose">
        <button type="button" className="btn" aria-label={`Choose ${label} file`} disabled={disabled || scanning} onClick={chooseFile}>
          Browse local files
        </button>
        <span className="handoff-file-name">{fileName}</span>
      </div>
      <span className="handoff-file-hint">JSON file · up to 4 MiB</span>
    </div>
  )
  const scanButton = (
    <button
      className={scanFirst ? 'btn primary' : 'btn'}
      aria-label={scanning ? 'Stop camera' : `Scan ${label} QR`}
      disabled={disabled}
      onClick={() => (scanning ? stop() : void scan())}
    >
      <DashboardIcon name="scan" />
      {scanning ? 'Stop camera' : `Scan ${label} QR`}
    </button>
  )
  return (
    <div className="handoff-exchange">
      {scanFirst ? (
        <>
          {scanButton}
          <details className="handoff-file-instead">
            <summary>Load a {label} file instead</summary>
            {fileBox}
          </details>
        </>
      ) : (
        <>
          {fileBox}
          {scanButton}
        </>
      )}
      <video
        className={scanning ? 'handoff-camera' : 'handoff-camera hidden'}
        ref={video}
        muted
        playsInline
        aria-label="Handoff camera preview"
      />
      {progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
