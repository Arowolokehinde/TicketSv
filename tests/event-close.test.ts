import {expect,it} from 'vitest'
import {requestsCloseAt} from '../server/event-close.ts'

// Requests stay open through the event's local date and close at the next local midnight.
it.each([
 ['2027-01-01','UTC','2027-01-02T00:00:00.000Z'],
 ['2027-01-01','Africa/Lagos','2027-01-01T23:00:00.000Z'],
 ['2027-01-01','Asia/Rangoon','2027-01-01T17:30:00.000Z'],
 ['2027-03-13','America/New_York','2027-03-14T05:00:00.000Z'],
 ['2027-11-06','America/New_York','2027-11-07T04:00:00.000Z'],
 ['2027-12-31','Pacific/Kiritimati','2027-12-31T10:00:00.000Z'],
])('%s in %s closes at %s',(date,zone,expected)=>{
 expect(requestsCloseAt(date,zone).toISOString()).toBe(expected)
})
it('America/Santiago closes at the transition instant when midnight is skipped',()=>{
 // Local 23:59 on 4 September 2027 is followed by 01:00 on the 5th.
 expect(requestsCloseAt('2027-09-04','America/Santiago').toISOString()).toBe('2027-09-05T04:00:00.000Z')
})
it.each([
 ['2027-01-01','Mars/Olympus'],
 ['2027-02-30','UTC'],
 ['2027-1-01','UTC'],
])('refuses %s in %s',(date,zone)=>{
 expect(()=>requestsCloseAt(date,zone)).toThrow(/date|timezone/i)
})
