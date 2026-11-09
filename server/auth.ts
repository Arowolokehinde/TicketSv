import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import type { Request, Response } from 'express'

export const SESSION_MS = 8 * 60 * 60_000
export const CHALLENGE_MS = 5 * 60_000
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex')
export const token = (): string => randomBytes(32).toString('hex')
export function cookie(req: Request, name: string): string {
  const matches = (req.headers.cookie ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='))
  if (matches.length !== 1) return ''
  const value = matches[0].slice(name.length + 1)
  return /^[0-9a-f]{64}$/.test(value) ? value : ''
}
export function setCookie(res: Response, name: string, value: string, origin: string, maxAge: number): void {
  res.cookie(name, value, { httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), path: '/', maxAge })
}
export async function sessionFor(pool: Pool, req: Request, origin: string, now: number) {
  const result = await pool.query('SELECT identity_key, expires_at FROM login_sessions WHERE token_hash=$1 AND origin=$2 AND expires_at>$3', [hashToken(cookie(req, 'ticketsv_session')), origin, now])
  const row = result.rows[0]
  return row ? { identityKey: row.identity_key as string, network: 'testnet' as const, expiresAt: new Date(Number(row.expires_at)).toISOString() } : null
}
