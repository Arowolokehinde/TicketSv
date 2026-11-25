// WhatsOnChain testnet, shared by the door's spend check and issuance recovery.
export const WOC = 'https://api.whatsonchain.com/v1/bsv/test'
const options = { credentials: 'omit', redirect: 'error', cache: 'no-store' } as const

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    signal.addEventListener('abort', stop, { once: true })
  })
}
// WhatsOnChain limits anonymous use; back off and retry a rate-limited request.
// Its 429 reply has no CORS header, so a browser sees a network error instead.
export async function wocRequest(get: typeof fetch, url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await get(url, { ...options, ...init, signal })
    } catch (error) {
      signal.throwIfAborted()
      if (attempt === 3 || !(error instanceof TypeError)) throw error
      await pause(1000 * 2 ** attempt, signal)
      continue
    }
    if (response.status !== 429 || attempt === 3) return response
    void response.body?.cancel().catch(() => {})
    await pause(1000 * 2 ** attempt, signal)
  }
}
