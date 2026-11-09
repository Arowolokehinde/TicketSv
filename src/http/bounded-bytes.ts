// Shared by server upstream downloads and browser batches. Bounds apply to streamed
// bytes, not just Content-Length. Abort cancels body reads and rejects late output.
export async function boundedBytes(response: Response, limit: number, signal: AbortSignal, requireOk = true): Promise<Uint8Array> {
 signal.throwIfAborted()
 if (requireOk && !response.ok) { void response.body?.cancel().catch(() => {}); throw Error(`Header service HTTP ${response.status}`) }
 if (!response.body || Number(response.headers.get('content-length')) > limit) { void response.body?.cancel().catch(() => {}); throw Error('Header response exceeds size limit.') }
 const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
 const stop = () => { void reader.cancel(signal.reason).catch(() => {}) }
 signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
 try {
  while (true) {
   const { done, value } = await reader.read(); signal.throwIfAborted(); if (done) break
   size += value.length; if (size > limit) throw Error('Header response exceeds size limit.')
   chunks.push(value)
  }
 } finally { signal.removeEventListener('abort', stop); void reader.cancel().catch(() => {}); reader.releaseLock() }
 const result = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
 return result
}
