import QRCode from 'qrcode'

// Camera-like test images: a rendered QR resized (bilinear), optionally
// placed in a 1920×1080 frame, as in scripts/compare-qr-readers.mjs.
type Image = { data: Uint8ClampedArray; width: number; height: number }
export async function renderQR(payload: Uint8Array | string, scale = 4, margin = 4): Promise<Image> {
  const segments = [
    typeof payload === 'string' ? { data: payload, mode: 'alphanumeric' as const } : { data: payload, mode: 'byte' as const },
  ]
  const { modules } = QRCode.create(segments as never, { errorCorrectionLevel: 'M' }),
    side = (modules.size + 2 * margin) * scale
  const data = new Uint8ClampedArray(side * side * 4).fill(255)
  for (let y = 0; y < modules.size; y++)
    for (let x = 0; x < modules.size; x++)
      if (modules.get(y, x))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const at = (((y + margin) * scale + dy) * side + (x + margin) * scale + dx) * 4
            data[at] = data[at + 1] = data[at + 2] = 0
          }
  return { data, width: side, height: side }
}
export function resize(image: Image, width: number): Image {
  const height = Math.round((image.height * width) / image.width),
    data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(image.width - 1, ((x + 0.5) * image.width) / width - 0.5)),
        sy = Math.max(0, Math.min(image.height - 1, ((y + 0.5) * image.height) / height - 0.5))
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        x1 = Math.min(x0 + 1, image.width - 1),
        y1 = Math.min(y0 + 1, image.height - 1),
        fx = sx - x0,
        fy = sy - y0,
        at = (y * width + x) * 4
      for (let c = 0; c < 3; c++)
        data[at + c] =
          image.data[(y0 * image.width + x0) * 4 + c] * (1 - fx) * (1 - fy) +
          image.data[(y0 * image.width + x1) * 4 + c] * fx * (1 - fy) +
          image.data[(y1 * image.width + x0) * 4 + c] * (1 - fx) * fy +
          image.data[(y1 * image.width + x1) * 4 + c] * fx * fy
      data[at + 3] = 255
    }
  return { data, width, height }
}
export function inFrame(image: Image, at: 'centre' | 'corner' = 'centre'): Image {
  const width = 1920,
    height = 1080,
    data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const left = at === 'centre' ? Math.floor((width - image.width) / 2) : 40,
    top = at === 'centre' ? Math.floor((height - image.height) / 2) : 40
  for (let y = 0; y < image.height; y++)
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + top) * width + left) * 4)
  return { data, width, height }
}
export const blankFrame = (): Image => {
  const data = new Uint8ClampedArray(1920 * 1080 * 4)
  data.fill(255)
  return { data, width: 1920, height: 1080 }
}
