import { expect, it } from 'vitest'
import { build } from 'vite'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { movedRoute } from '../src/navigation/moved.ts'

it('production build leaves out development screens', async () => {
  const marker = 'Local SPV experiment.'
  expect(await readFile('src/dev/SpvExperimentPanel.tsx', 'utf8')).toContain(marker)
  const previous = process.env.VITE_DEV_ROUTES
  delete process.env.VITE_DEV_ROUTES
  try {
    const built = await build({ configFile: resolve('vite.config.ts'), logLevel: 'silent', build: { write: false } })
    const code = (Array.isArray(built) ? built : [built])
      .flatMap(result => ('output' in result ? result.output : []))
      .map(item => (item.type === 'chunk' ? item.code : ''))
      .join('\n')
    expect(code).toContain('Page not found')
    expect(code).not.toContain(marker)
    expect(code).not.toContain('Sample evidence')
    // The QR reader's WASM ships with the app, byte for byte, and the offline app
    // cache stores it, so scanning works without a connection.
    const output = (Array.isArray(built) ? built : [built]).flatMap(result => ('output' in result ? result.output : []))
    const reader = readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')
    const wasm = output.find(
      item => item.type === 'asset' && item.fileName.endsWith('.wasm') && Buffer.from(item.source as Uint8Array).equals(reader),
    )
    expect(wasm).toBeTruthy()
    const source = (name: string) => {
      const file = output.find(item => item.type === 'asset' && item.fileName === name)
      return String(file && 'source' in file ? file.source : '')
    }
    // One app worker lists the files; the earlier per-page workers only retire themselves.
    expect(source('ticketsv-offline-worker.js')).toContain('/' + wasm!.fileName)
    for (const retired of ['attendee-offline-worker.js', 'scanner-offline-worker.js']) {
      expect(source(retired)).toContain('self.registration.unregister()')
      expect(source(retired)).not.toContain('/assets/')
    }
  } finally {
    if (previous !== undefined) process.env.VITE_DEV_ROUTES = previous
  }
}, 120_000)

it('sends old placeholder links to the real pages', () => {
  expect(movedRoute('/tickets/receive')).toBe('/offline/handoff?step=receive')
  expect(movedRoute('/tickets/transfer')).toBe('/offline/handoff?step=prepare')
  expect(movedRoute('/tickets/sample')).toBe('/tickets')
  expect(movedRoute('/tickets/prepare')).toBe('/tickets')
  expect(movedRoute('/venue/prepare')).toBe('/venue')
  expect(movedRoute('/tickets')).toBeUndefined()
  expect(movedRoute('/scanner/prepare')).toBeUndefined()
})
