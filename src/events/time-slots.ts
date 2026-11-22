// Event start times are saved as 24-hour HH:MM. The picker offers quarter hours
// and also accepts any typed time, in 24- or 12-hour form.
const pad = (n: number) => String(n).padStart(2, '0')
export const TIME_SLOTS: readonly string[] = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)

export function parseTime(text: string): string | undefined {
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm)?$/.exec(text.trim().toLowerCase().replace(/\s+/g, ''))
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0),
    half = match[3]
  if (minute > 59) return undefined
  if (half) {
    if (hour < 1 || hour > 12) return undefined
    hour = (hour % 12) + (half === 'pm' ? 12 : 0)
  } else if (hour > 23) return undefined
  return `${pad(hour)}:${pad(minute)}`
}

// The options for a query. A saved time off the quarter-hour grid stays listed.
export function matchTimes(query: string, value: string): string[] {
  const all = value && !TIME_SLOTS.includes(value) && parseTime(value) === value ? [...TIME_SLOTS, value].sort() : [...TIME_SLOTS]
  const q = query.trim().toLowerCase()
  if (!q) return all
  if (/^\d{1,2}$/.test(q)) return all.filter(time => Number(time.slice(0, 2)) === Number(q))
  const exact = parseTime(q)
  if (exact) return [exact]
  return all.filter(time => time.startsWith(q.replace('.', ':')))
}
