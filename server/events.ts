import type { Pool } from 'pg'
import type { EventDetails } from '../src/events/drafts.ts'
import { validateEventDetails } from '../src/events/drafts.ts'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function eventInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Enter event details.')
  const input = value as Record<string, unknown>
  let image: Blob | null = null
  let wire: { type: string; data: string } | null = null
  if (input.image !== null) {
    wire = input.image as { type: string; data: string } | null
    if (!wire || !['image/png', 'image/jpeg', 'image/webp'].includes(wire.type) || typeof wire.data !== 'string' || wire.data.length > 2_666_668 || !/^[A-Za-z0-9+/]*={0,2}$/.test(wire.data)) throw new ApiError(400, 'Choose a PNG, JPEG or WebP image up to 2 MB.')
    const bytes = Buffer.from(wire.data, 'base64')
    const magic = wire.type === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : wire.type === 'image/jpeg' ? bytes.subarray(0, 3).toString('hex') === 'ffd8ff' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    if (!magic || bytes.toString('base64') !== wire.data) throw new ApiError(400, 'The image format does not match its contents.')
    image = new Blob([bytes], { type: wire.type })
  }
  try { return { ...validateEventDetails({ ...input, image } as EventDetails), image: wire } }
  catch (error) { throw new ApiError(400, (error as Error).message) }
}
export function eventRecord(row: Record<string, any>) {
  return { ...row.details, id: row.id, status: 'draft', revision: row.revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}
export async function updateEvent(pool: Pool, owner: string, id: string, revision: unknown, details: Record<string, unknown>) {
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new ApiError(400, 'Invalid event revision.')
  const result = await pool.query('UPDATE organiser_events SET details=$1, revision=revision+1, updated_at=now() WHERE id=$2 AND owner_key=$3 AND revision=$4 RETURNING *', [details, id, owner, revision])
  if (result.rowCount) return eventRecord(result.rows[0])
  const exists = await pool.query('SELECT id FROM organiser_events WHERE id=$1 AND owner_key=$2', [id, owner])
  throw new ApiError(exists.rowCount ? 409 : 404, exists.rowCount ? 'This event changed in another tab. Copy your changes and reload before editing again.' : 'Event not found.')
}
