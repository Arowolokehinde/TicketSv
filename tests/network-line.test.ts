import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NetworkLine, networkReport, networkSummary } from '../src/ui/NetworkLine.tsx'
import { measured, type NetworkRequest, type NetworkWindow } from '../src/network/recorder.ts'

const request = (purpose: string, outcome: NetworkRequest['outcome'], at: number): NetworkRequest => ({
  at,
  method: 'GET',
  host: 'h',
  path: '/p',
  purpose,
  outcome,
  status: outcome === 'ok' ? 200 : undefined,
})
const window_ = (requests: NetworkRequest[], otherLoads: number | null): NetworkWindow => ({
  label: 'Ticket verification',
  startedAt: requests[0]?.at ?? 0,
  endedAt: requests.at(-1)?.at ?? 0,
  measured: true,
  requests,
  requestCount: requests.length,
  otherLoads,
})

describe('network line', () => {
  it('shows not measured for an unregistered report', () => {
    expect(networkSummary(undefined)).toEqual(['Network during this check: not measured.'])
    expect(renderToStaticMarkup(createElement(NetworkLine, { of: { verdict: 'verified' } }))).toContain(
      'Network during this check: not measured.',
    )
  })
  it('shows not measured when the recorder was not installed', async () => {
    const report = await measured('Ticket verification', async () => ({ verdict: 'verified' }))
    expect(renderToStaticMarkup(createElement(NetworkLine, { of: report }))).toContain('Network during this check: not measured.')
  })
  it('states a check without requests', () => {
    expect(networkSummary(window_([], 0))).toEqual(['Network during this check: none. Other browser loads: 0.'])
  })
  it('groups requests by destination and outcome', () => {
    const at = new Date(2026, 10, 17, 14, 2).getTime()
    const lines = networkSummary(
      window_(
        [
          request('TicketSV headers', 'ok', at),
          request('TicketSV headers', 'ok', at + 1000),
          request('WhatsOnChain', 'offline', at + 60_000),
        ],
        null,
      ),
    )
    expect(lines[0]).toBe('Network during this check: 3 requests, 14:02–14:03.')
    expect(lines[1]).toBe('TicketSV headers ×2 (ok) · WhatsOnChain ×1 (failed: offline)')
    expect(lines[2]).toBe('Other browser loads: not measured.')
  })
  it('reports measured request counts for downloads, never an assumed zero', () => {
    expect(networkReport(undefined)).toBe('not measured')
    expect(networkReport({ ...window_([], 0), measured: false })).toBe('not measured')
    expect(networkReport(window_([], 0))).toEqual({ requests: 0, otherBrowserLoads: 0 })
    expect(networkReport(window_([request('Headers', 'ok', 1), request('Headers', 'offline', 2)], null))).toEqual({
      requests: 2,
      otherBrowserLoads: 'not measured',
    })
  })
})
