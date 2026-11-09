// Developer diagnostics only. Never retain request bodies, stacks or full replies.
export type ErrorSummary = { name?: string; code?: string | number; message?: string }
export type WalletFailureResponse = ErrorSummary & { method: string; status: number }

export function summarizeError(value: unknown): ErrorSummary {
  if (value === null || typeof value !== 'object') return { message: 'No structured error was available.' }
  const error = value as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string'
    ? value.slice(0, 2048).replace(/[0-9a-fA-F]{64,}/g, '[hex omitted]').slice(0, 600) : undefined
  return { name: text(error.name), message: text(error.message),
    code: typeof error.code === 'number' && Number.isFinite(error.code) ? error.code : text(error.code) }
}

export async function readFailureResponse(response: Response, method: string): Promise<WalletFailureResponse> {
  const result: WalletFailureResponse = { method, status: response.status }
  const reader = response.clone().body?.getReader()
  if (!reader) return result
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) return result
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return { ...result, ...summarizeError(JSON.parse(new TextDecoder().decode(bytes))) }
  } catch { return result }
  finally { void reader.cancel().catch(() => {}) }
}
