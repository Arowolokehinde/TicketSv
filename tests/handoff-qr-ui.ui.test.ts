import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import QRCode from 'qrcode'
import { encodeTicketQR } from '../src/handoff/ticket-qr-payload.ts'
import { resolve } from 'node:path'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { fromAttendee, invitationFor, readHandoffRequest } from '../src/handoff/evidence.ts'
import { createReceivingRequest } from '../src/handoff/wallet.ts'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
let browser: Browser, bundle: string
const wasmAssets = new Map<string, Uint8Array>()
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/handoff-qr-browser-entry.tsx'), name: 'HandoffQRTest', formats: ['es'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('No bundle')
  for (const asset of result.output)
    if (asset.type === 'asset' && asset.fileName.endsWith('.wasm'))
      wasmAssets.set('/' + asset.fileName, typeof asset.source === 'string' ? new TextEncoder().encode(asset.source) : asset.source)
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
it('imports a saved static QR image offline without playback or collecting frames', async () => {
  const page = await browser.newPage(),
    f = await attendeeOfflineFixture('https://ticketsv.example'),
    ticket = fromAttendee(attendeeEvidence(f.record, f.identity, 'https://ticketsv.example')),
    wallet = Object.assign(new ProtoWallet(new PrivateKey(3)), { getNetwork: async () => ({ network: 'testnet' as const }) }),
    value = await createReceivingRequest(wallet, invitationFor(ticket, 1767665), new AbortController().signal)
  try {
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1:4175')
    await page.addScriptTag({ type: 'module', content: bundle })
    await page.waitForFunction(() => !!(window as any).HandoffQRTest)
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value), value)
    await page.getByRole('button', { name: 'Show receiving request QR', exact: true }).click()
    await page.getByRole('img', { name: 'receiving request QR', exact: true }).waitFor()
    const image = await page.getByRole('img').getAttribute('src')
    await page.getByRole('button', { name: 'Hide receiving request QR', exact: true }).click()
    await page.context().setOffline(true)
    // Feed the actual displayed QR pixels into the real camera decoding loop.
    await page.evaluate(async image => {
      const screenshot = new Image()
      screenshot.src = image!
      await screenshot.decode()
      const original = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, source: CanvasImageSource, ...args: any[]) {
        if (source instanceof HTMLVideoElement) {
          return (original as any).call(this, screenshot, ...args)
        }
        return (original as any).call(this, source, ...args)
      } as typeof original
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
      })
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {} })
      HTMLMediaElement.prototype.play = async () => {}
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => screenshot.naturalWidth })
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => screenshot.naturalHeight })
    }, image)
    await page.getByRole('button', { name: 'Scan receiving request QR', exact: true }).click()
    await page
      .waitForFunction(() => !!document.body.dataset.received, null, { timeout: 15000 })
      .catch(async error => {
        throw Error(`${error.message} UI: ${await page.locator('body').innerText()}`)
      })
    expect(readHandoffRequest(JSON.parse((await page.locator('body').getAttribute('data-received'))!))).toEqual(value)
    expect(await page.getByRole('alert').count()).toBe(0)
    await page.getByRole('button', { name: 'Show receiving request QR', exact: true }).click()
    await page.getByRole('img', { name: 'receiving request QR', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: /frames/ }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Save QR image', exact: true }).isVisible()).toBe(true)
  } finally {
    await page.close()
  }
}, 20000)

it('offers the intact file when a package cannot fit one QR, including QR-only dialogs', async () => {
  const page = await browser.newPage(),
    bytes = crypto.getRandomValues(new Uint8Array(15000)),
    value = { data: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') }
  try {
    await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1:4175')
    await page.addScriptTag({ type: 'module', content: bundle })
    await page.waitForFunction(() => !!(window as any).HandoffQRTest)
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    await page.getByRole('status').filter({ hasText: 'too large for one QR' }).waitFor()
    expect(await page.getByRole('img').count()).toBe(0)
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save receiving request file', exact: true }).click()
    const download = await pending,
      stream = await download.createReadStream(),
      parts: Buffer[] = []
    for await (const chunk of stream!) parts.push(Buffer.from(chunk))
    expect(JSON.parse(Buffer.concat(parts).toString())).toEqual(value)
    expect(await page.getByRole('button', { name: /frames/ }).count()).toBe(0)
  } finally {
    await page.close()
  }
})

it('keeps scanning after empty, partial and unrelated QR readings before decoding a binary ticket offline', async () => {
  const { compactTicketFixture } = await import('./helpers/compact-ticket-fixture.ts')
  const value = process.env.TICKETSV_QR_TEST_FILE
    ? JSON.parse(await (await import('node:fs/promises')).readFile(process.env.TICKETSV_QR_TEST_FILE, 'utf8'))
    : (await compactTicketFixture()).transfer
  const sender = await browser.newContext({ viewport: { width: 390, height: 850 }, deviceScaleFactor: 2 }),
    receiver = await browser.newContext()
  const page = await sender.newPage(),
    scan = await receiver.newPage()
  let external = 0
  try {
    for (const context of [sender, receiver])
      await context.route('**/*', route => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
        external++
        return route.abort()
      })
    for (const p of [page, scan]) {
      await p.goto('https://ticketsv.example/offline/handoff')
      await p.addScriptTag({ type: 'module', content: bundle })
      await p.waitForFunction(() => !!(window as any).HandoffQRTest)
    }
    await sender.setOffline(true)
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    const img = page.getByRole('img')
    await img.waitFor({ timeout: 10000 }).catch(async e => {
      throw Error(e.message + ' UI: ' + (await page.locator('body').innerText()) + ' emitted wasm: ' + [...wasmAssets.keys()].join(','))
    })
    await page.waitForFunction(() => document.querySelector('img')?.complete)
    expect(
      await page.evaluate(() => {
        const img = document.querySelector('img')!
        return Math.abs(img.naturalWidth / img.getBoundingClientRect().width - devicePixelRatio) < 0.01
      }),
    ).toBe(true)
    const screenshot = await img.screenshot(),
      url = 'data:image/png;base64,' + screenshot.toString('base64')
    await scan.evaluate(async () => {
      ;(window as any).HandoffQRTest.mount({})
      await (window as any).HandoffQRTest.prepareTicketQRDecoder()
    })
    await receiver.setOffline(true)
    await scan.evaluate(
      async ({ url, noise }) => {
        const saved = new Image()
        saved.src = url
        await saved.decode()
        const readings = await Promise.all(
          noise.map(async src => {
            const image = new Image()
            image.src = src
            await image.decode()
            return image
          }),
        )
        const original = CanvasRenderingContext2D.prototype.drawImage
        let frames = 0
        CanvasRenderingContext2D.prototype.drawImage = function (
          this: CanvasRenderingContext2D,
          source: CanvasImageSource,
          ...args: any[]
        ) {
          return source instanceof HTMLVideoElement
            ? (original as any).call(this, readings[frames++] ?? saved, ...args)
            : (original as any).call(this, source, ...args)
        } as typeof original
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
        })
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {} })
        HTMLMediaElement.prototype.play = async () => {}
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => saved.naturalWidth })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => saved.naturalHeight })
      },
      { url, noise: await Promise.all([' ', '{', 'https://example.com'].map(text => QRCode.toDataURL(text, { width: 600, margin: 4 }))) },
    )
    await scan.getByRole('button', { name: 'Scan receiving request QR', exact: true }).click()
    await scan
      .waitForFunction(() => !!document.body.dataset.received, null, { timeout: 10000 })
      .catch(async error => {
        throw Error(`${error.message} UI: ${await scan.locator('body').innerText()}`)
      })
    expect(JSON.parse((await scan.locator('body').getAttribute('data-received'))!)).toEqual(value)
    expect(await scan.getByRole('alert').count()).toBe(0)
    expect(external).toBe(0)
  } finally {
    await sender.close()
    await receiver.close()
  }
}, 30000)

it('reads a dense phone ticket within a full-resolution laptop camera frame offline', async () => {
  const { compactTicketFixture } = await import('./helpers/compact-ticket-fixture.ts'),
    value = (await compactTicketFixture()).transfer
  const payload = await encodeTicketQR(JSON.stringify(value)),
    side = (QRCode.create([{ data: payload as Uint8Array, mode: 'byte' }], { errorCorrectionLevel: 'M' }).modules.size + 8) * 2
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, deviceScaleFactor: 2 }),
    sender = await context.newPage(),
    scan = await context.newPage()
  let external = 0
  try {
    await context.route('**/*', r => {
      if (r.request().isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
      external++
      return r.abort()
    })
    for (const page of [sender, scan]) {
      await page.goto('https://ticketsv.example/scanner')
      await page.addScriptTag({ type: 'module', content: bundle })
      await page.waitForFunction(() => !!(window as any).HandoffQRTest)
    }
    await sender.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    const img = sender.getByRole('img')
    await img.waitFor()
    await sender.waitForFunction(() => document.querySelector('img')?.complete)
    const url = 'data:image/png;base64,' + (await img.screenshot()).toString('base64')
    await scan.evaluate(
      async ({ url, side }) => {
        ;(window as any).HandoffQRTest.mount({})
        await (window as any).HandoffQRTest.prepareTicketQRDecoder()
        const saved = new Image()
        saved.src = url
        await saved.decode()
        const frame = document.createElement('canvas')
        frame.width = 1920
        frame.height = 1080
        const ctx = frame.getContext('2d')!
        ctx.fillStyle = '#999'
        ctx.fillRect(0, 0, 1920, 1080)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(saved, Math.floor((1920 - side) / 2), Math.floor((1080 - side) / 2), side, side)
        const original = CanvasRenderingContext2D.prototype.drawImage
        CanvasRenderingContext2D.prototype.drawImage = function (
          this: CanvasRenderingContext2D,
          source: CanvasImageSource,
          ...args: any[]
        ) {
          return source instanceof HTMLVideoElement
            ? (original as any).call(this, frame, ...args)
            : (original as any).call(this, source, ...args)
        } as typeof original
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
        })
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {} })
        HTMLMediaElement.prototype.play = async () => {}
        Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 })
      },
      { url, side },
    )
    await context.setOffline(true)
    await scan.getByRole('button', { name: 'Scan receiving request QR', exact: true }).click()
    await scan
      .waitForFunction(() => !!document.body.dataset.received, null, { timeout: 8000 })
      .catch(async error => {
        throw Error(`${error.message} UI: ${await scan.locator('body').innerText()}`)
      })
    expect(JSON.parse((await scan.locator('body').getAttribute('data-received'))!)).toEqual(value)
    expect(external).toBe(0)
  } finally {
    await context.close()
  }
}, 20000)

async function shownQR() {
  const { compactTicketFixture } = await import('./helpers/compact-ticket-fixture.ts'),
    value = (await compactTicketFixture()).transfer
  const page = await browser.newPage({ viewport: { width: 390, height: 850 }, deviceScaleFactor: 2 })
  await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('https://ticketsv.example/offline/handoff')
  await page.addScriptTag({ type: 'module', content: bundle })
  await page.waitForFunction(() => !!(window as any).HandoffQRTest)
  return { page, value }
}
it('opens the QR full screen and closes it on tap or Escape', async () => {
  const { page, value } = await shownQR()
  try {
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    const small = await page.getByRole('img', { name: 'receiving request QR', exact: true }).getAttribute('src')
    await page.getByRole('button', { name: 'Show to scanner', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'receiving request QR, full screen' })
    await dialog.waitFor()
    const big = dialog.getByRole('img')
    await big.waitFor()
    // Same code, drawn larger: fills most of the screen's shorter side.
    expect((await big.boundingBox())!.width).toBeGreaterThan(300)
    expect(small).toBeTruthy()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Show to scanner', exact: true }).click()
    await dialog.waitFor()
    await dialog.click()
    await dialog.waitFor({ state: 'detached' })
  } finally {
    await page.close()
  }
}, 20000)
it('keeps the screen awake while full screen and releases it on close', async () => {
  const { page, value } = await shownQR()
  try {
    await page.evaluate(() => {
      ;(window as any).locks = []
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async (type: string) => {
            const lock = {
              type,
              released: false,
              release: async () => {
                lock.released = true
              },
            }
            ;(window as any).locks.push(lock)
            return lock
          },
        },
      })
    })
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    await page.getByRole('button', { name: 'Show to scanner', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as any).locks.map((l: any) => l.type))).toEqual(['screen'])
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => (window as any).locks[0].released)).toBe(true)
  } finally {
    await page.close()
  }
}, 20000)
it('opens full screen without wake lock support', async () => {
  const { page, value } = await shownQR()
  try {
    await page.evaluate(() => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }))
    await page.evaluate(value => (window as any).HandoffQRTest.mount(value, true), value)
    await page.getByRole('button', { name: 'Show to scanner', exact: true }).click()
    await page.getByRole('dialog', { name: 'receiving request QR, full screen' }).waitFor()
    expect(await page.getByRole('alert').count()).toBe(0)
  } finally {
    await page.close()
  }
}, 20000)
