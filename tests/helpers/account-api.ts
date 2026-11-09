import type { BrowserContext } from '@playwright/test'

// UI fixtures only. Real BRC signatures, SQL ownership and cookies are exercised
// separately by signed-auth.browser.test.ts and backend.test.ts.
export async function accountApi(context: BrowserContext, signedIn = true) {
  let session: object | null = signedIn ? { identityKey: '02' + '11'.repeat(32), network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() } : null
  const records = new Map<string, any>()
  await context.route('**/api/auth/session', route => route.fulfill({ status: session ? 200 : 401, json: session ?? { error: 'Sign in to continue.' } }))
  await context.route('**/api/auth/logout', route => { session = null; return route.fulfill({ json: { signedOut: true } }) })
  await context.route('**/api/events**', async route => {
    const request = route.request(), url = new URL(request.url()), id = url.pathname.split('/')[3]
    if (request.method() === 'GET') { await route.fulfill({ status: id && !records.has(id) ? 404 : 200, json: id ? records.get(id) ?? { error: 'Event not found.' } : { events: [...records.values()], nextOffset: null } }); return }
    const body = request.postDataJSON(), previous = id ? records.get(id) : undefined
    if (id && previous?.revision !== body.revision) { await route.fulfill({ status: 409, json: { error: 'This event changed in another tab. Copy your changes and reload before editing again.' } }); return }
    const record = { ...body, id: id ?? crypto.randomUUID(), status: 'draft', revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
    records.set(record.id, record)
    await route.fulfill({ json: record })
  })
  return { setSession: (value: object | null) => { session = value }, records }
}
