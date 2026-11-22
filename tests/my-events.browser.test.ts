import { test, expect } from '@playwright/test'
import { accountApi } from './helpers/account-api.ts'

const harbour = 'b54a41c1-e532-42d4-8f86-04f91c547d73',
  gallery = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
  requestId = '7e0c4b9a-1f2d-4e3c-9b8a-6d5e4f3a2b1c',
  attendee = '03' + '44'.repeat(32)
const created = new Date('2026-11-19T10:00:00Z').toISOString()
const draft = (id: string, name: string) => ({
  id,
  name,
  description: '',
  date: '2027-06-12',
  time: '19:30',
  timezone: 'Africa/Lagos',
  venue: 'Harbour Hall',
  address: '14 Marina Road',
  image: null,
  revision: 1,
  status: 'draft',
  publication: { published: true, revision: 1 },
  createdAt: created,
  updatedAt: created,
})
const request = {
  id: requestId,
  eventId: harbour,
  event: { ...draft(harbour, 'Harbour Nights'), venueIdentity: '02' + '11'.repeat(32) },
  proof: { attendee, request: { requestId, recipient: { publicKey: '03' + '22'.repeat(32) } } },
  createdAt: created,
  ticketId: null,
  status: 'requested',
}

test('My events counts waiting requests, groups them by event and opens one for review', async ({ page, context }) => {
  const fixture = await accountApi(context)
  fixture.records.set(gallery, { ...draft(gallery, 'Quiet Gallery'), issued: 2 })
  fixture.records.set(harbour, draft(harbour, 'Harbour Nights'))
  const waitingCalls: string[] = []
  await context.route('**/api/events/requests/waiting**', route => {
    const limit = new URL(route.request().url()).searchParams.get('limit')
    waitingCalls.push(limit ?? '')
    return route.fulfill({ json: { total: 1, requests: limit === '0' ? [] : [request] } })
  })
  await context.route('**/api/events/*/requests**', route => route.fulfill({ json: { requests: [request], nextOffset: null } }))
  let reviewed: { attendeeRequestId?: string } | undefined
  await context.route('**/api/events/*/issuances**', route => {
    if (route.request().method() === 'POST') {
      reviewed = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        json: {
          id: '4dfe41f8-9716-4974-999b-79fb6a840d5d',
          eventId: harbour,
          owner: '02' + '11'.repeat(32),
          eventRevision: 1,
          event: draft(harbour, 'Harbour Nights'),
          status: 'prepared',
          txid: null,
          pkg: null,
          attendeeRequestId: requestId,
          request: request.proof.request,
          createdAt: created,
          updatedAt: created,
        },
      })
    }
    return route.fulfill({ json: { issuances: [] } })
  })
  let walletCalls = 0
  await context.route('http://localhost:3321/**', route => {
    walletCalls++
    return route.abort()
  })

  await page.goto('/venue')
  const nav = page.getByRole('navigation', { name: 'Ticket holder navigation' })
  await expect(nav.getByRole('link', { name: 'Create event', exact: true })).toHaveAttribute('href', '/venue')
  await nav.getByRole('link', { name: 'My events (1)', exact: true }).click()
  await expect(page).toHaveURL(/\/venue\/my-events$/)
  await expect(page.getByRole('heading', { name: 'My events', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'My events (1)', exact: true })).toHaveAttribute('aria-current', 'page')
  // The page's own list supplies the count, so it asks the server once.
  expect(waitingCalls).toEqual(['0', '100'])

  const events = page.locator('.my-events-event')
  await expect(events.nth(0)).toContainText('Harbour Nights')
  await expect(events.nth(0)).toContainText('Awaiting review')
  await expect(events.nth(0)).toContainText('034444…444444')
  await expect(events.nth(0).locator('.my-events-summary')).toHaveText('1 waiting · 0 tickets issued')
  await expect(events.nth(1)).toContainText('Quiet Gallery')
  await expect(events.nth(1).locator('.my-events-summary')).toHaveText('No requests waiting · 2 tickets issued')
  // Each event appears once, with its management actions here rather than on Create event.
  await expect(page.getByRole('button', { name: 'Tickets for Quiet Gallery' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Manage publication for Quiet Gallery' })).toHaveCount(1)

  await events.nth(0).getByRole('button', { name: 'Review request from 034444…444444' }).click()
  await expect(page.getByRole('heading', { name: 'Issue a ticket' })).toBeVisible()
  await expect(page.getByText('Review the attendee and event below. No transaction has been created.')).toBeVisible()
  expect(reviewed?.attendeeRequestId).toBe(requestId)
  await page.getByRole('button', { name: 'Back to My events', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'My events', exact: true })).toBeVisible()
  expect(walletCalls).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('My events with no events points to Create event', async ({ page, context }) => {
  await accountApi(context)
  await context.route('**/api/events/requests/waiting**', route => route.fulfill({ json: { total: 0, requests: [] } }))
  await page.goto('/venue/my-events')
  const nav = page.getByRole('navigation', { name: 'Ticket holder navigation' })
  await expect(nav.getByRole('link', { name: 'My events', exact: true })).toBeVisible()
  await expect(page.getByText("You haven't created an event yet.")).toBeVisible()
  await expect(page.locator('.event-empty').getByRole('link', { name: 'Create event' })).toHaveAttribute('href', '/venue')
})

test('Create event opens straight to the form and saving lands on My events', async ({ page, context }) => {
  const fixture = await accountApi(context)
  await context.route('**/api/events/requests/waiting**', route => route.fulfill({ json: { total: 0, requests: [] } }))
  await page.goto('/venue')
  await expect(page.getByRole('heading', { name: 'Create event', exact: true })).toBeVisible()
  await expect(page.locator('.event-card')).toHaveCount(0)
  await page.getByLabel('Event name', { exact: true }).fill('Lagos Lights')
  await page.getByLabel('Event date', { exact: true }).fill('2027-06-12')
  await page.getByLabel('Start time', { exact: true }).fill('19:30')
  await page.getByLabel('Venue name', { exact: true }).fill('Harbour Hall')
  await page.getByLabel('Venue address', { exact: true }).fill('14 Marina Road')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/venue\/my-events$/)
  await expect(page.getByText('Draft saved to your account. No tickets have been issued.')).toBeVisible()
  await expect(page.locator('.my-events-event')).toContainText('Lagos Lights')
  expect(fixture.records.size).toBe(1)
})
