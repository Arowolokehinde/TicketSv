import { describe, expect, it } from 'vitest'
import { validateEventDetails } from '../src/events/drafts.ts'

const details = { name: ' Harbour Nights ', description: 'Live music', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Harbour Hall', address: '14 Marina Road', image: null }
describe('event draft validation', () => {
  it('normalizes text without changing the specified wall-clock date or timezone', () => {
    expect(validateEventDetails(details)).toEqual({ ...details, name: 'Harbour Nights' })
  })
  it.each([
    ['name', '   '], ['date', '2027-02-29'], ['date', '2027-04-31'], ['date', 'junk'],
    ['time', '24:00'], ['timezone', 'not/a-zone'], ['venue', ''], ['address', ''], ['description', 'a'.repeat(4001)],
  ])('rejects invalid %s rather than saving misleading event details', (field, value) => {
    expect(() => validateEventDetails({ ...details, [field]: value })).toThrow()
  })
  it('accepts leap day and permits editing past events', () => {
    expect(validateEventDetails({ ...details, date: '2024-02-29' }).date).toBe('2024-02-29')
  })
  it('rejects unsafe or excessive image data', () => {
    expect(() => validateEventDetails({ ...details, image: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })).toThrow()
    expect(() => validateEventDetails({ ...details, image: new Blob([new Uint8Array(2_000_001)], { type: 'image/png' }) })).toThrow()
  })
})
