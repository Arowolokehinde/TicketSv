import { boundedBytes } from '../http/bounded-bytes.ts'
let authEpoch = 0
let authIdentity: string | null = null
export const currentAuthIdentity = () => authIdentity
export const currentAuthEpoch = () => authEpoch
export const advanceAuthEpoch = (identity: string | null) => { authEpoch++; authIdentity = identity }
export type AuthSession = { identityKey: string; network: 'testnet'; expiresAt: string }
export class ApiFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export async function api<T>(path: string, init: RequestInit = {}, maxResponseBytes?: number): Promise<T> {
  const epoch = currentAuthEpoch()
  let response: Response
  try { response = await fetch(path, { ...init, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/json', ...((path.startsWith('/api/events') || path.startsWith('/api/tickets')) && authIdentity ? { 'x-ticketsv-identity': authIdentity } : {}), ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) }) }
  catch (error) { if (init.signal?.aborted) throw error; throw new ApiFailure(0, 'TicketSV could not reach its server. Check your connection and try again.') }
  let body: { error?: string }
  try { body = maxResponseBytes === undefined ? await response.json() : JSON.parse(new TextDecoder().decode(await boundedBytes(response, maxResponseBytes, init.signal ?? AbortSignal.timeout(15_000), false))) }
  catch (error) { if(init.signal?.aborted) throw init.signal.reason; if(maxResponseBytes !== undefined && response.ok) throw error; throw new ApiFailure(response.status, 'The TicketSV API is unavailable. Start the API server and try again.') }
  if ((path.startsWith('/api/events') || path.startsWith('/api/tickets')) && epoch !== currentAuthEpoch()) throw new ApiFailure(409, 'The signed-in account changed. Reload your events.')
  if (!response.ok) {
    if (response.status === 401 && (path.startsWith('/api/events') || path.startsWith('/api/tickets'))) window.dispatchEvent(new CustomEvent('ticketsv-session-expired', { detail: epoch }))
    throw new ApiFailure(response.status, body.error ?? 'The request could not be completed.')
  }
  return body as T
}
