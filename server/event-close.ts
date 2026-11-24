// Ticket requests stay open through the event's local date. The closing instant
// is computed here, once, at publication; Postgres then compares timestamps and
// never has to interpret timezone names that Node accepted.
const DAY = 86_400_000
export function requestsCloseAt(date: string, timeZone: string): Date {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Invalid event date.')
  const [year, month, day] = date.split('-').map(Number),
    start = new Date(Date.UTC(year, month - 1, day))
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) throw Error('Invalid event date.')
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
  } catch {
    throw Error('Invalid event timezone.')
  }
  // Local wall-clock time of an instant, expressed as if it were UTC.
  const wall = (instant: number) => {
    const p = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]))
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  }
  const target = start.getTime() + DAY // next local midnight, as a wall-clock value
  const candidates = [...new Set([target - DAY, target, target + DAY].map(t => target - (wall(t) - t)))].sort((a, b) => a - b)
  const exact = candidates.find(c => wall(c) === target)
  if (exact !== undefined) return new Date(exact) // earliest instant when midnight repeats
  // Midnight is skipped by a daylight-saving change: close at the transition.
  let low = Math.max(...candidates.filter(c => wall(c) < target)),
    high = Math.min(...candidates.filter(c => wall(c) > target && c > low))
  if (!Number.isFinite(low) || !Number.isFinite(high)) throw Error('Invalid event timezone.')
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (wall(middle) >= target) high = middle
    else low = middle
  }
  return new Date(high)
}
