// Fixed-window counter per client key. On Vercel the key is the client IP that
// Vercel writes (one trusted proxy hop); a Vercel WAF rule provides the shared,
// cross-instance limit at the edge. This in-process counter is the fallback.
export function createRateLimiter({
  limit,
  windowMs,
  maxKeys,
  now,
}: {
  limit: number
  windowMs: number
  maxKeys: number
  now: () => number
}): (key: string) => boolean {
  const windows = new Map<string, { count: number; until: number }>()
  return key => {
    const time = now()
    for (const [client, state] of windows) if (state.until <= time) windows.delete(client)
    const state = windows.get(key) ?? { count: 0, until: time + windowMs }
    if (++state.count > limit || (windows.size >= maxKeys && !windows.has(key))) return false
    windows.set(key, state)
    return true
  }
}
