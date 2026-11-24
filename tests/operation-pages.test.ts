import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityView, headerSummary } from '../src/ui/OperationPages.tsx'
import { DeviceStatus } from '../src/ui/Workspace.tsx'
import type { HeaderSnapshot } from '../src/headers/validate.ts'

const snapshot = (source?: 'ticketsv-cache') =>
  ({
    version: 1,
    network: 'testnet',
    id: 'x',
    syncedAt: '2026-11-17T14:02:00.000Z',
    headers: [{ height: 1762324 }, { height: 1762325 }],
    ...(source ? { source } : {}),
  }) as unknown as HeaderSnapshot

describe('operation pages', () => {
  it('summarises the saved header snapshot', () => {
    expect(headerSummary(undefined)).toBeUndefined()
    expect(headerSummary(snapshot('ticketsv-cache'))).toMatchObject({
      range: '1,762,324–1,762,325 (2 headers)',
      source: 'TicketSV shared cache, checked on this device',
    })
    expect(headerSummary(snapshot())?.source).toBe('WhatsOnChain and Chaintracks, compared on this device')
  })
  it('lists measured checks and requests with what the app cannot see', () => {
    const at = new Date(2026, 10, 17, 14, 3).getTime()
    const html = renderToStaticMarkup(
      createElement(ActivityView, {
        onClear: vi.fn(),
        activity: {
          checks: [
            {
              label: 'Ticket verification',
              startedAt: at,
              endedAt: at,
              measured: true,
              requests: [],
              requestCount: 0,
              otherLoads: 0,
              verdict: 'verified',
            },
          ],
          requests: [
            {
              at,
              method: 'GET',
              host: 'ticketsv.example',
              path: '/api/headers/range',
              purpose: 'TicketSV headers',
              outcome: 'offline',
              ms: 12,
            },
          ],
        },
      }),
    )
    expect(html).toContain('Ticket verification')
    expect(html).toContain('verified')
    expect(html).toContain('0 network requests')
    expect(html).toContain('TicketSV headers')
    expect(html).toContain('/api/headers/range')
    expect(html).toContain('failed: offline')
    expect(html).toContain('BSV Browser wallet')
    expect(html).not.toContain('not implemented')
  })
  it('shows an empty journal plainly', () => {
    expect(renderToStaticMarkup(createElement(ActivityView, { onClear: vi.fn(), activity: { checks: [], requests: [] } }))).toContain(
      'No network requests recorded on this device.',
    )
  })
  it('no longer shows fixed device claims', () => {
    const html = renderToStaticMarkup(createElement(DeviceStatus, { root: '/tickets', signedIn: true }))
    expect(html).not.toContain('Proof size')
    expect(html).not.toContain('None contacted by the app')
    expect(html).toContain('Network activity')
  })
})
