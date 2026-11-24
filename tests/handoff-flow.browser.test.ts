import { expect, test, type Page, type BrowserContext } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { LockingScript, MerklePath, OP, Transaction, Utils, type ProtoWallet } from '@bsv/sdk'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { sourceKey } from '../src/handoff/store.ts'
import { FUNDING_PROTOCOL } from '../src/handoff/wallet.ts'
import { invitationFor } from '../src/handoff/evidence.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import header from './fixtures/headers/woc-1762324.json' with { type: 'json' }
declare global {
  interface Window {
    HandoffTest: typeof import('./helpers/handoff-browser-entry.tsx')
  }
}
const snapshot = makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)])
let bundle: string, styles: string[]
test.beforeAll(async () => {
  const signing = resolve('src/verification/signing-spv.ts'),
    tracker = resolve('src/headers/tracker.ts'),
    mining = resolve('src/settlement/evidence.ts')
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_SHARED_HEADERS': '"false"' },
    plugins: [
      {
        name: 'synthetic-header-boundary',
        async load(id) {
          if (id === signing) {
            const s = await readFile(id, 'utf8')
            return (
              s.slice(0, s.indexOf('export async function verifySigningEvidence')) +
              `export async function verifySigningEvidence(e,snapshot){if(!snapshot)throw Error('Missing headers');const tx=Transaction.fromAtomicBEEF(e.atomicBeef);if(!await tx.verify(createLocalTracker(snapshot)))throw Error('Invalid scripts');return {subjectMined:!!tx.merklePath}}`
            )
          }
          if (id === tracker)
            return `export class MissingHeaderError extends Error{};export function createLocalTracker(){return {isValidRootForHeight:async()=>true,currentHeight:async()=>2000000}}`
          if (id === mining) {
            const s = await readFile(id, 'utf8')
            return (
              s.slice(0, s.indexOf('export function verifyMiningAnchor')) +
              `export function verifyMiningAnchor(){return true}\n` +
              s.slice(s.indexOf('export function minedCandidate'))
            )
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/handoff-browser-entry.tsx'), name: 'HandoffTest', formats: ['iife'] },
    },
  })
  const output = Array.isArray(built) ? built[0] : built
  if (!('output' in output)) throw Error('No bundle')
  bundle = output.output
    .filter(x => x.type === 'chunk')
    .map(x => x.code)
    .join('\n')
  styles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/href="([^"]+\.css)"/g)].map(m => m[1])
})
async function mount(page: Page, step?: 'receive' | 'prepare') {
  const selected = step ?? (new URL(page.url()).searchParams.get('step') === 'receive' ? 'receive' : 'prepare')
  await page.route(
    url => url.pathname === '/offline/handoff',
    r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="test-root"></div>' }),
  )
  await page.goto(`/offline/handoff?step=${selected}`)
  await page.addScriptTag({ content: bundle })
  for (const url of styles) await page.addStyleTag({ url })
  await page.evaluate(
    async snapshot =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('counterfoil-spv-experiment-v1', 2)
        r.onupgradeneeded = () => {
          for (const s of ['snapshots', 'chunks']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s)
        }
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction('snapshots', 'readwrite')
          tx.objectStore('snapshots').put(snapshot, 'accepted')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onabort = () => reject(tx.error)
        }
      }),
    snapshot,
  )
}
async function wallet(context: BrowserContext, w: ProtoWallet, fail = { signatures: 0 }) {
  const calls: string[] = []
  await context.route('http://localhost:3321/**', async r => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (r.request().method() === 'OPTIONS') {
      await r.fulfill({ status: 204, headers })
      return
    }
    const method = new URL(r.request().url()).pathname.split('/').at(-1)!,
      args = r.request().postDataJSON()
    calls.push(method)
    let result: unknown
    if (method === 'getNetwork') result = { network: 'testnet' }
    else if (method === 'getPublicKey') result = await w.getPublicKey(args)
    else if (method === 'createSignature' && fail.signatures > 0) {
      fail.signatures--
      await r.fulfill({ status: 400, headers, json: { status: 'error', code: 'ERR_TEST', description: 'Wallet response lost' } })
      return
    } else if (method === 'createSignature') result = await w.createSignature(args)
    // A wallet that cannot build the transfer itself: signing falls back to local PushDrop signatures.
    else if (method === 'createAction') {
      await r.fulfill({
        status: 400,
        headers,
        json: { status: 'error', code: 'ERR_NOT_SUPPORTED', description: 'Transfer building is unavailable in this test wallet.' },
      })
      return
    } else throw Error('Unexpected wallet mutation: ' + method)
    await r.fulfill({ headers, json: result })
  })
  return calls
}
async function file(page: Page, label: string, value: unknown) {
  await page
    .getByLabel(label, { exact: true })
    .setInputFiles({ name: 'evidence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
}
test('two distinct wallets exchange and verify a real signed transfer offline, surviving reload', async ({ page, context, browser }) => {
  const f = await handoffFixture(),
    failures = { signatures: 0 },
    calls = await wallet(context, f.sender, failures),
    otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4175' }),
    other = await otherContext.newPage(),
    recipientCalls = await wallet(otherContext, f.recipient)
  const blocked: string[] = []
  for (const c of [context, otherContext])
    await c.route('**/api/**', r => {
      blocked.push(r.request().url())
      return r.abort()
    })
  const key = { protocolID: FUNDING_PROTOCOL, keyID: sourceKey(f.source), counterparty: 'self', publicKey: '' }
  key.publicKey = (await f.sender.getPublicKey({ ...key, forSelf: true })).publicKey
  const script = new LockingScript()
    .writeBin(Utils.toArray(key.publicKey, 'hex'))
    .writeOpCode(OP.OP_CHECKSIG)
    .writeBin(Utils.toArray(JSON.stringify(['ticketsv-handoff-fee', 1, 'testnet', key.keyID]), 'utf8'))
    .writeOpCode(OP.OP_DROP) as LockingScript
  const fee = new Transaction(1, [], [{ satoshis: 5, lockingScript: script }])
  fee.merklePath = new MerklePath(1762325, [
    [
      { offset: 1, hash: fee.id('hex'), txid: true },
      { offset: 0, hash: '11'.repeat(32) },
    ],
  ])
  const now = new Date().toISOString(),
    record = {
      kind: 'ticketsv-handoff-sender',
      version: 1,
      id: sourceKey(f.source),
      revision: 0,
      ticket: f.source,
      fundAttempt: { id: crypto.randomUUID(), outcome: 'complete', startedAt: now, finishedAt: now },
      funding: {
        key,
        amount: 5,
        policy: { maxTxBytes: 100000, feeSatoshis: 1, feeBytes: 1000 },
        txid: fee.id('hex'),
        index: 0,
        beef: Utils.toBase64(fee.toAtomicBEEF()),
        observation: {
          txid: fee.id('hex'),
          txStatus: 'MINED',
          observedAt: now,
          blockHash: header.hash,
          blockHeight: 1762325,
          merklePath: fee.merklePath.toHex(),
        },
      },
    }
  await mount(page)
  await page.evaluate(
    async ({ source, record }) => {
      await window.HandoffTest.saveAttendeeTicket(source.issuanceEvidence, location.origin, new AbortController().signal, () => {})
      await window.HandoffTest.senderStore.save(window.HandoffTest.readSender(record), undefined)
      window.HandoffTest.render()
    },
    { source: f.source, record },
  )
  await mount(other, 'receive')
  await other.evaluate(() => window.HandoffTest.render())
  await other.getByRole('button', { name: 'Receive', exact: true }).click()
  await otherContext.route(`**/api/marketplace/events/${f.source.pkg.issuance.eventId}`, r =>
    r.fulfill({ json: { ...f.source.event, id: f.source.pkg.issuance.eventId, revision: 1, venueIdentity: f.source.trustedVenue } }),
  )
  await file(other, 'Load invitation file', invitationFor(f.source, 1762424))
  await other.getByRole('checkbox', { name: /I reviewed this published event/ }).check()
  await other.getByRole('button', { name: 'Save organiser review', exact: true }).click()
  await other.getByRole('checkbox', { name: /I authorize receiving-key and identity signatures/ }).check()
  await other.getByRole('button', { name: 'Create receiving request', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Your request is saved' })).toBeVisible()
  // The steps show in order, and only the current step's controls are on the page.
  const steps = other.getByRole('region', { name: 'Receive steps' })
  await expect(steps.locator('li', { hasText: 'Receiving request created' })).toHaveAttribute('data-state', 'done')
  await expect(steps.locator('li[data-current]')).toContainText('Request shown to the sender')
  await expect(other.getByLabel('Load invitation file')).toHaveCount(0)
  // Each step says what was just finished and the one thing to do next.
  const otherNext = other.getByRole('region', { name: 'Next step' })
  await expect(otherNext).toContainText('Done: Receiving request created')
  await expect(otherNext).toContainText('Next: Show your request to the sender, by QR or file.')
  await expect(other.getByLabel('Load ticket file')).toHaveCount(0)
  const request = await other.evaluate(async () => (await window.HandoffTest.recipientStore.list())[0].request)
  expect(request.recipientIdentity).not.toBe(f.source.holder)
  // Once prepared, B is pointed to Send instead of searching for it.
  await page.getByLabel('Choose handoff ticket').selectOption(record.id)
  await expect(page.getByRole('heading', { name: 'Invite the recipient' })).toBeVisible()
  const pageNext = page.getByRole('region', { name: 'Next step' })
  await expect(pageNext).toContainText('Done: Ready for offline transfer')
  await expect(pageNext).toContainText('Share the invitation with the recipient.')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toContainText('Ready')
  await page.getByRole('button', { name: 'Continue to Send', exact: true }).click()
  await expect(pageNext).toContainText("Load the recipient's receiving request")
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveAttribute('aria-current', 'step')
  // Only the local wallet transport is reachable during the offline part.
  for (const p of [page, other])
    await p.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
      dispatchEvent(new Event('offline'))
    })
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByLabel('Choose handoff ticket').selectOption(record.id)
  await file(page, 'Load receiving request file', request)
  await expect(pageNext).toContainText('Done: Receiving request loaded')
  // The wallet's answer is lost after it was asked: only the same recipient can be retried.
  failures.signatures = 1
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Sign offline transfer', exact: true }).click()
  await expect(pageNext).toContainText('Retry signing for the same recipient.')
  await expect(page.getByText('Only the same recipient can be used.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Load receiving request file')).toHaveCount(0)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Retry signing for the same recipient', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transfer signed and saved' })).toBeVisible()
  await expect(pageNext).toContainText('Show ticket QR, then Show to scanner.')
  // Back on Prepare, a signed ticket points to Send instead of inviting a recipient again.
  await page.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(page.getByText('This ticket is signed and saved.', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Invite the recipient' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toContainText('Ready')
  await page.getByRole('button', { name: 'Continue to Send', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transfer signed and saved' })).toBeVisible()
  // On the sender's Confirm, only the seller's parts show, and the wallet is checked before any release.
  await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
  await expect(page.getByText('You sent this ticket.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check recipient wallet', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check my wallet', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Release spent outputs', exact: true })).toHaveCount(0)
  // A saved release that found both outputs already gone has nothing left to do or recheck.
  await page.evaluate(async () => {
    const a = window.HandoffTest,
      sender = (await a.senderStore.list())[0],
      checkedAt = new Date().toISOString(),
      gone = { state: 'absent' as const, checkedAt, reason: 'Not listed.' }
    await a.senderReleaseStore.save(
      {
        kind: 'ticketsv-sender-release',
        version: 1,
        id: a.sourceKey(sender.ticket),
        revision: 0,
        transferTxid: sender.transfer!.pkg.current.txid,
        verifiedAt: checkedAt,
        snapshotId: 'seeded',
        outputs: [
          { basket: 'ticketsv-tickets', outpoint: `${sender.ticket.pkg.current.txid}.${sender.ticket.pkg.current.index}`, attempts: [], observation: gone },
          { basket: 'ticketsv-handoff-fees', outpoint: `${sender.funding!.txid}.${sender.funding!.index}`, attempts: [], observation: gone },
        ],
      },
      undefined,
    )
  })
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('Nothing to remove. Your wallet no longer lists them.', { exact: true })).toBeVisible()
  await expect(page.getByText('Wallet: not listed', { exact: false })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Recheck wallet', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check my wallet', exact: true })).toHaveCount(0)
  await page.evaluate(async () => {
    const a = window.HandoffTest
    await a.senderReleaseStore.remove(a.sourceKey((await a.senderStore.list())[0].ticket), 0)
  })
  const transfer = await page.evaluate(async () => (await window.HandoffTest.senderStore.list())[0].transfer!)
  expect(Transaction.fromAtomicBEEF(Utils.toArray(transfer.pkg.atomicBeefBase64, 'base64')).inputs).toHaveLength(2)
  // The phone can't see the sender scan the request, so the receiver moves on.
  await other.getByRole('button', { name: "I've shown it, continue", exact: true }).click()
  await expect(other.getByRole('heading', { name: "Scan the sender's ticket." })).toBeVisible()
  await expect(steps.locator('li[data-current]')).toContainText('Ticket received from the sender')
  await expect(otherNext).toContainText('Then tap Scan ticket QR.')
  await expect(other.getByRole('button', { name: 'Scan ticket QR', exact: true })).toBeVisible()
  await other.getByRole('button', { name: 'Show my request again', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Your request is saved' })).toBeVisible()
  await other.getByRole('button', { name: "I've shown it, continue", exact: true }).click()
  await file(other, 'Load ticket file', transfer)
  await expect(other.getByRole('heading', { name: 'Ticket evidence: verified' })).toBeVisible()
  await expect(otherNext).toContainText('Done: Ticket verified on this phone')
  await expect(steps.locator('li', { hasText: 'Ticket received from the sender' })).toHaveAttribute('data-state', 'done')
  await expect(steps.locator('li', { hasText: 'Ticket verified on this phone' })).toHaveAttribute('data-state', 'done')
  await expect(
    other.getByText('No device can rule out that the seller also signed it to someone else offline', { exact: false }),
  ).toBeVisible()
  // One lost signature, then the retry's two.
  expect(calls.filter(c => c === 'createSignature')).toHaveLength(3)
  expect(calls.filter(c => c === 'createAction')).toHaveLength(2)
  expect(recipientCalls.filter(c => c === 'createSignature')).toHaveLength(2)
  expect(blocked).toEqual([])
  const count = recipientCalls.length
  await mount(other, 'receive')
  await other.evaluate(() => window.HandoffTest.render())
  await other.getByRole('button', { name: 'Receive', exact: true }).click()
  await other.getByLabel('Saved receiving request').selectOption({ index: 1 })
  await other.getByRole('button', { name: 'Verify locally', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Ticket evidence: verified' })).toBeVisible()
  expect(recipientCalls).toHaveLength(count)
  // Start a new handoff shows the invitation loader; the saved request stays in the list.
  await other.getByLabel('Saved receiving request').selectOption('')
  await expect(other.getByRole('heading', { name: "Load the sender's invitation." })).toBeVisible()
  await expect(other.getByLabel('Load invitation file')).toHaveCount(1)
  await expect(other.getByLabel('Saved receiving request').locator('option')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('signed-handoff.png') })
  await other.unrouteAll()
  await other.goto('/offline/tickets')
  await expect(other.getByRole('link', { name: 'Open received ticket' })).toBeVisible()
  await other.getByRole('link', { name: 'Open received ticket' }).click()
  await expect(other.getByRole('region', { name: 'Receive steps' }).locator('li', { hasText: 'Ticket received from the sender' })).toHaveAttribute('data-state', 'done')
  expect(recipientCalls).toHaveLength(count)
  await otherContext.close()
})
test('publication and recipient import have separate approvals', async ({ page }) => {
  const f = await handoffFixture(true)
  await mount(page, 'receive')
  await page.evaluate(async ticket => {
    const a = window.HandoffTest,
      r = a.newSettlement(ticket)
    await a.settlementStore.save(r, undefined)
    await a.settlementStore.save(
      { ...r, revision: 1, wallet: { state: 'absent', checkedAt: new Date().toISOString(), reason: 'Test observation' } },
      0,
    )
    a.render()
  }, f.ticket)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByLabel('Saved transfer', { exact: true }).selectOption({ index: 1 })
  await expect(page.getByText('You received this ticket.', { exact: true })).toBeVisible()
  const publish = page.getByRole('checkbox', { name: /publishing/ }),
    add = page.getByRole('checkbox', { name: /adding this exact/ })
  await publish.check()
  await expect(page.getByRole('button', { name: 'Publish transfer', exact: true })).toBeEnabled()
  await expect(add).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Add received ticket to wallet', exact: true })).toBeDisabled()
  await publish.uncheck()
  await add.check()
  await expect(page.getByRole('button', { name: 'Publish transfer', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add received ticket to wallet', exact: true })).toBeEnabled()
})
test('stopping camera before permission resolves closes its late stream', async ({ page }) => {
  await mount(page, 'receive')
  await page.evaluate(() => {
    let resolve!: (s: MediaStream) => void
    ;(window as unknown as { lateCamera: () => void }).lateCamera = () =>
      resolve({
        getTracks: () => [
          {
            stop: () => {
              document.body.dataset.cameraStopped = 'yes'
            },
          },
        ],
      } as unknown as MediaStream)
    navigator.mediaDevices.getUserMedia = () =>
      new Promise(r => {
        resolve = r
      })
    window.HandoffTest.render()
  })
  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  await page.getByRole('button', { name: 'Scan invitation QR' }).click()
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await page.evaluate(() => (window as unknown as { lateCamera: () => void }).lateCamera())
  await expect(page.locator('body')).toHaveAttribute('data-camera-stopped', 'yes')
})
test('explicit publication, mined verification and recipient import remain separate steps', async ({ page, context }) => {
  const f = await handoffFixture(),
    calls: string[] = [],
    publications: string[] = []
  let published = false,
    owned = false
  const proof = new MerklePath(1762324, [
    [
      { offset: 1, hash: f.tx.id('hex'), txid: true },
      { offset: 0, hash: '22'.repeat(32) },
    ],
  ])
  await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/**', async r => {
    const path = new URL(r.request().url()).pathname
    if (path === '/policy') {
      await r.fulfill({ json: { policy: { maxtxsizepolicy: 100000, miningFee: { satoshis: 0, bytes: 1000 } } } })
      return
    }
    if (r.request().method() === 'POST') {
      publications.push(r.request().postData()!)
      published = true
      await r.fulfill({ json: { txid: f.tx.id('hex'), txStatus: 'RECEIVED' } })
      return
    }
    if (!published) {
      await r.fulfill({ status: 404, body: 'not found' })
      return
    }
    await r.fulfill({
      json: { txid: f.tx.id('hex'), txStatus: 'MINED', blockHash: header.hash, blockHeight: 1762324, merklePath: proof.toHex() },
    })
  })
  await context.route('http://localhost:3321/**', async r => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (r.request().method() === 'OPTIONS') {
      await r.fulfill({ status: 204, headers })
      return
    }
    const method = new URL(r.request().url()).pathname.split('/').at(-1)!,
      args = r.request().postDataJSON(),
      key = f.ticket.pkg.request.recipient
    calls.push(method)
    let result: unknown
    if (method === 'getNetwork') result = { network: 'testnet' }
    else if (method === 'getPublicKey') result = await f.recipient.getPublicKey(args)
    else if (method === 'listOutputs')
      result = {
        totalOutputs: owned ? 1 : 0,
        outputs: owned
          ? [
              {
                outpoint: f.tx.id('hex') + '.0',
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
      }
    else if (method === 'internalizeAction') {
      expect(args.outputs[0].outputIndex).toBe(0)
      expect(Transaction.fromAtomicBEEF(args.tx).id('hex')).toBe(f.tx.id('hex'))
      owned = true
      result = { accepted: true }
    } else throw Error('Unexpected wallet mutation ' + method)
    await r.fulfill({ headers, json: result })
  })
  await mount(page, 'receive')
  await page.evaluate(async ticket => {
    const a = window.HandoffTest
    await a.settlementStore.save(a.newSettlement(ticket), undefined)
    a.render()
  }, f.ticket)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByLabel('Saved transfer', { exact: true }).selectOption({ index: 1 })
  expect(publications).toEqual([])
  expect(calls).toEqual([])
  await page.getByRole('checkbox', { name: /publishing/ }).check()
  await page.getByRole('button', { name: 'Publish transfer', exact: true }).click()
  await expect(page.getByText('Publication outcome saved.', { exact: false })).toBeVisible()
  expect(publications).toEqual([f.tx.toHexEF()])
  await page.getByRole('button', { name: 'Check transfer status', exact: true }).click()
  await page.getByRole('button', { name: 'Verify mining evidence', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ticket evidence: verified' })).toBeVisible()
  expect(calls).toEqual([])
  // Once mined, the proof replaces the spent ancestors and the ticket gets smaller.
  await expect(page.locator('.handoff-evidence-size')).toHaveText(
    /^Ticket evidence: \d+\.\d KB · \d+ transactions · \d+ mining proofs? → \d+\.\d KB · 1 transaction · 1 mining proof after mining\. Earlier history is replaced by one mining proof\.$/,
  )
  // The door needs only the smaller ticket proof; the full record stays for the buyer.
  await expect(page.getByRole('button', { name: 'Show door ticket QR', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show updated ticket QR', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Check recipient wallet', exact: true }).click()
  const add = page.getByRole('button', { name: 'Add received ticket to wallet', exact: true })
  await expect(add).toBeDisabled()
  await page.getByRole('checkbox', { name: /adding this exact/ }).check()
  await add.click()
  await expect(page.getByText('Import response: accepted.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Wallet record: present/)).toBeVisible()
  expect(calls.filter(c => c === 'internalizeAction')).toHaveLength(1)
  const count = calls.length
  await mount(page, 'receive')
  await page.evaluate(() => window.HandoffTest.render())
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.getByLabel('Saved transfer', { exact: true }).selectOption({ index: 1 })
  await expect(page.getByText('Import response: accepted.', { exact: true })).toBeVisible()
  expect(calls).toHaveLength(count)
  expect(publications).toHaveLength(1)
  // The Transfer page's Confirm lists only transfers this device sent.
  await mount(page, 'prepare')
  await page.evaluate(() => window.HandoffTest.render())
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('No sent transfers on this device yet.', { exact: true })).toBeVisible()
})
