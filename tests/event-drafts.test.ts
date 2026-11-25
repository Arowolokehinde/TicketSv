import { describe, expect, it } from 'vitest'
import { validateEventDetails } from '../src/events/drafts.ts'

const details = {
  name: ' Harbour Nights ',
  description: 'Live music',
  date: '2027-06-12',
  time: '19:30',
  timezone: 'Africa/Lagos',
  venue: 'Harbour Hall',
  address: '14 Marina Road',
  image: null,
}
describe('event draft validation', () => {
  it('normalizes text without changing the specified wall-clock date or timezone', () => {
    expect(validateEventDetails(details)).toEqual({ ...details, name: 'Harbour Nights' })
  })
  it.each([
    ['name', '   ', 'Enter an event name (up to 120 characters).'],
    ['date', '2027-02-29', 'Choose a valid event date.'],
    ['date', '2027-04-31', 'Choose a valid event date.'],
    ['date', 'junk', 'Choose a valid event date.'],
    ['time', '24:00', 'Choose a valid start time.'],
    ['timezone', 'not/a-zone', 'Choose a valid timezone, such as UTC, Europe/Madrid or America/New_York.'],
    ['venue', '', 'Enter a venue name (up to 160 characters).'],
    ['address', '', 'Enter a venue address (up to 300 characters).'],
    ['description', 'a'.repeat(4001), 'Enter a description or leave it blank (up to 4000 characters).'],
  ])('rejects invalid %s rather than saving misleading event details', (field, value, message) => {
    expect(() => validateEventDetails({ ...details, [field]: value })).toThrow(message)
  })
  it('accepts leap day and permits editing past events', () => {
    expect(validateEventDetails({ ...details, date: '2024-02-29' }).date).toBe('2024-02-29')
  })
  it('rejects unsafe or excessive image data', () => {
    expect(() => validateEventDetails({ ...details, image: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })).toThrow(
      'Choose a PNG, JPEG or WebP image up to 2 MB.',
    )
    expect(() => validateEventDetails({ ...details, image: new Blob([new Uint8Array(2_000_001)], { type: 'image/png' }) })).toThrow(
      'Choose a PNG, JPEG or WebP image up to 2 MB.',
    )
  })
})
