import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import header from './fixtures/headers/woc-1762324.json' with { type: 'json' }
declare global {
  interface Window {
    WalletRecordTest: typeof import('./helpers/wallet-record-browser-entry.tsx')
  }
}
let browser: Browser, bundle: string, css: string
beforeAll(async () => {
  const target = resolve('src/verification/signing-spv.ts')
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_SHARED_HEADERS': '"false"' },
    plugins: [
      {
        name: 'synthetic-anchor',
        async load(id) {
          if (id === target) {
            const code = await readFile(target, 'utf8')
            return (
              code.slice(0, code.indexOf('export async function verifySigningEvidence')) +
              `export async function verifySigningEvidence(e,snapshot){if(!snapshot)throw Error('Missing headers');return {subjectMined:!!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath}}`
            )
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/wallet-record-browser-entry.tsx'), name: 'WalletRecordTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('No bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  css = result.output.flatMap(p => (p.type === 'asset' && p.fileName.endsWith('.css') ? [String(p.source)] : [])).join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
it('keeps absent and present wallet states concise, requires consent and separates acknowledgement from presence', async () => {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }),
      page = await context.newPage(),
      f = await attendeeOfflineFixture()
    let owned = false,
      imports = 0,
      reads = 0
    page.setDefaultTimeout(3000)
    try {
      await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
      await context.route('http://localhost:3321/**', async r => {
        if (r.request().method() === 'OPTIONS')
          return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
        const method = new URL(r.request().url()).pathname.slice(1),
          args = r.request().postDataJSON(),
          key = f.record.request.recipient
        if (method === 'internalizeAction') imports++
        if (method === 'listOutputs') reads++
        const results = {
          getNetwork: { network: 'testnet' },
          getVersion: { version: 'wallet-brc100-1.0.0' },
          getPublicKey: { publicKey: args.identityKey ? f.identity : key.publicKey },
          listOutputs: {
            totalOutputs: owned ? 1 : 0,
            outputs: owned
              ? [
                  {
                    outpoint: `${f.record.txid}.0`,
                    satoshis: 1,
                    spendable: true,
                    lockingScript: f.tx.outputs[0].lockingScript.toHex(),
                    customInstructions: JSON.stringify({
                      type: 'PushDrop',
                      protocolID: key.protocolID,
                      keyID: key.keyID,
                      counterparty: key.counterparty,
                    }),
                  },
                ]
              : [],
          },
          internalizeAction: { accepted: true },
        }
        if (!(method in results)) throw Error('Unexpected wallet operation ' + method)
        return r.fulfill({ json: results[method as keyof typeof results], headers: { 'Access-Control-Allow-Origin': '*' } })
      })
      await page.goto('http://127.0.0.1:4175/tickets')
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: bundle })
      await page.evaluate(
        async ({ record, owner, snapshot }) => {
          await window.WalletRecordTest.saveSnapshot(snapshot)
          window.WalletRecordTest.mount(record, owner)
        },
        { record: f.record, owner: f.identity, snapshot: makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)]) },
      )
      await page.getByRole('button', { name: 'Check wallet readiness', exact: true }).click()
      const add = page.getByRole('button', { name: 'Add ticket to wallet', exact: true })
      await add.waitFor()
      expect(await add.isDisabled()).toBe(true)
      expect(await page.getByRole('link', { name: 'Prepare fees and hand off' }).count()).toBe(0)
      expect(await page.getByText('Wallet record: absent', { exact: true }).isVisible()).toBe(true)
      expect(await page.getByText(f.record.request.recipient.publicKey, { exact: true }).isVisible()).toBe(false)
      await mkdir('.superpowers/sdd/wallet-record', { recursive: true })
      await page.screenshot({ path: `.superpowers/sdd/wallet-record/absent-${width}.png`, fullPage: true })
      await page.getByRole('checkbox').check()
      await add.click()
      // The mock acknowledges import but intentionally continues listing absence.
      await page.getByText('Import response: accepted', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Recheck wallet record', exact: true }).waitFor()
      await page.getByText('Wallet record: absent', { exact: true }).waitFor()
      expect(await page.getByText('Wallet record: absent', { exact: true }).isVisible()).toBe(true)
      expect(await page.getByText('Ticket is in your wallet.', { exact: true }).count()).toBe(0)
      expect(await add.count()).toBe(0)
      expect(imports).toBe(1)
      owned = true
      await page.getByRole('button', { name: 'Recheck wallet record', exact: true }).click()
      await page.getByText('Wallet record: present', { exact: true }).waitFor()
      expect(await page.getByRole('link', { name: 'Prepare fees and hand off' }).count()).toBe(0)
      expect(await page.getByText('Import response: accepted', { exact: true }).isVisible()).toBe(true)
      expect(await page.getByText('Preparation complete', { exact: true }).isVisible()).toBe(true)
      expect(imports).toBe(1)
      expect(reads).toBeGreaterThan(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.superpowers/sdd/wallet-record/present-${width}.png`, fullPage: true })
    } finally {
      await context.close()
    }
  }
}, 15000)
