export type EventDetails = {
  name: string
  description: string
  date: string
  time: string
  timezone: string
  venue: string
  address: string
  image: Blob | null
}

export type EventDraft = EventDetails & {
  id: string
  status: 'draft'
  revision: number
  createdAt: string
  updatedAt: string
}

export function validateEventDetails(input: EventDetails): EventDetails {
  const text = (value: string, label: string, max: number, required = true) => {
    if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max) {
      throw new Error(`Enter ${label}${required ? '' : ' or leave it blank'} (up to ${max} characters).`)
    }
    return value.trim()
  }
  const name = text(input.name, 'an event name', 120)
  const description = text(input.description, 'a description', 4000, false)
  const venue = text(input.venue, 'a venue name', 160)
  const address = text(input.address, 'a venue address', 300)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < '1900-01-01' || input.date > '9999-12-31') throw new Error('Choose a valid event date.')
  const date = new Date(`${input.date}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date) throw new Error('Choose a valid event date.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('Choose a valid start time.')
  const timezone = text(input.timezone, 'a timezone', 100)
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(date) }
  catch { throw new Error('Choose a valid timezone, such as UTC, Europe/Madrid or America/New_York.') }
  if (input.image !== null && (!(input.image instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(input.image.type) || input.image.size > 2_000_000)) {
    throw new Error('Choose a PNG, JPEG or WebP image up to 2 MB.')
  }
  return { name, description, venue, address, date: input.date, time: input.time, timezone, image: input.image }
}

export function readEventDraft(value: unknown): EventDraft {
  const record = value as EventDraft | null
  if (!record || typeof record.id !== 'string' || !record.id || record.status !== 'draft' || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
    typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error('A saved event could not be read. Existing records have not been changed.')
  }
  return { ...validateEventDetails(record), id: record.id, status: 'draft', revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt }
}
