import { describe, expect, it } from 'vitest'
import { TIME_SLOTS, matchTimes, parseTime } from '../src/events/time-slots.ts'

describe('start time slots', () => {
  it('lists every quarter hour of the day', () => {
    expect(TIME_SLOTS).toHaveLength(96)
    expect(TIME_SLOTS[0]).toBe('00:00')
    expect(TIME_SLOTS.at(-1)).toBe('23:45')
  })
  it('reads typed times in 24- or 12-hour form', () => {
    for (const text of ['19:30', '1930', '19.30', '7:30 pm', '7:30PM']) expect(parseTime(text)).toBe('19:30')
    expect(parseTime('7pm')).toBe('19:00')
    expect(parseTime('7 am')).toBe('07:00')
    expect(parseTime('12am')).toBe('00:00')
    expect(parseTime('12pm')).toBe('12:00')
    expect(parseTime('7')).toBe('07:00')
    expect(parseTime('19')).toBe('19:00')
    for (const text of ['24:00', '7:60', '13pm', 'abc', '']) expect(parseTime(text)).toBeUndefined()
  })
  it('keeps an off-grid saved time in order', () => {
    const all = matchTimes('', '14:19')
    expect(all).toHaveLength(97)
    expect(all.slice(all.indexOf('14:15'), all.indexOf('14:15') + 3)).toEqual(['14:15', '14:19', '14:30'])
    expect(matchTimes('', '19:30')).toHaveLength(96)
  })
  it('narrows the list as you type', () => {
    expect(matchTimes('19', '')).toEqual(['19:00', '19:15', '19:30', '19:45'])
    expect(matchTimes('7pm', '')).toEqual(['19:00'])
    expect(matchTimes('19:3', '')).toEqual(['19:30'])
    expect(matchTimes('14:19', '')).toEqual(['14:19'])
    expect(matchTimes('zz', '')).toEqual([])
  })
})
