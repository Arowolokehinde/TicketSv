import { networkFor, type NetworkRequest, type NetworkWindow } from '../network/recorder.ts'

const clock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const outcomeText = (r: Pick<NetworkRequest, 'outcome' | 'status'>): string =>
  r.outcome === 'ok'
    ? 'ok'
    : r.outcome === 'http-error'
      ? `HTTP ${r.status}`
      : r.outcome === 'offline'
        ? 'failed: offline'
        : r.outcome === 'aborted'
          ? 'cancelled'
          : 'failed'
// For downloaded reports: the measured counts, or 'not measured'. Never an assumed zero.
export function networkReport(w: NetworkWindow | undefined): { requests: number; otherBrowserLoads: number | 'not measured' } | 'not measured' {
  if (!w?.measured) return 'not measured'
  return { requests: w.requestCount, otherBrowserLoads: w.otherLoads ?? 'not measured' }
}
export function networkSummary(w: NetworkWindow | undefined): string[] {
  if (!w?.measured) return ['Network during this check: not measured.']
  const others = `Other browser loads: ${w.otherLoads ?? 'not measured'}.`
  if (!w.requestCount) return [`Network during this check: none. ${others}`]
  const groups = new Map<string, number>()
  for (const r of w.requests) {
    const key = `${r.purpose} ×# (${outcomeText(r)})`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const listed =
    [...groups].map(([key, n]) => key.replace('#', String(n))).join(' · ') +
    (w.requestCount > w.requests.length ? ` · ${w.requestCount - w.requests.length} more` : '')
  const first = w.requests[0]?.at ?? w.startedAt,
    last = w.requests.at(-1)?.at ?? w.endedAt
  return [
    `Network during this check: ${w.requestCount} request${w.requestCount === 1 ? '' : 's'}, ${clock(first)}–${clock(last)}.`,
    listed,
    others,
  ]
}
// Measured network use for one verification report. A report produced
// without measurement says so rather than claiming none.
export function NetworkLine({ of }: { of: unknown }): React.JSX.Element {
  return (
    <div className="network-line">
      {networkSummary(networkFor(of)).map(line => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}
