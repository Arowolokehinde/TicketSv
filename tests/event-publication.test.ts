import { expect, it } from 'vitest'
import { UNPUBLISHED, publicationLabel, readPublication } from '../src/events/publication.ts'

it('labels an event by whether its saved version is the public one', () => {
  expect(publicationLabel(1, UNPUBLISHED)).toBe('Not published')
  expect(publicationLabel(3, { published: true, revision: 3 })).toBe('Published')
  expect(publicationLabel(4, { published: true, revision: 3 })).toBe('Published · edits not public')
  expect(publicationLabel(4, { published: false, revision: 3 })).toBe('Not published')
})

it('reads publication status from the server', () => {
  expect(readPublication(undefined)).toEqual(UNPUBLISHED)
  expect(readPublication({ published: true, revision: 2 })).toEqual({ published: true, revision: 2 })
  for (const bad of [null, { published: 'yes', revision: 1 }, { published: true, revision: 1.5 }, { published: true }])
    expect(() => readPublication(bad)).toThrow('Invalid publication status.')
})
