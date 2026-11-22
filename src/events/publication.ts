// Whether an organiser's event is on the public Events page, and which saved version is.
export type Publication = { published: boolean; revision: number | null }
export const UNPUBLISHED: Publication = { published: false, revision: null }

export function readPublication(value: unknown): Publication {
  if (value === undefined) return UNPUBLISHED
  const p = value as Publication | null
  if (!p || typeof p.published !== 'boolean' || !(p.revision === null || Number.isSafeInteger(p.revision)))
    throw new Error('Invalid publication status.')
  return { published: p.published, revision: p.revision }
}

export function publicationLabel(revision: number, publication: Publication): string {
  if (!publication.published) return 'Not published'
  return publication.revision === revision ? 'Published' : 'Published · edits not public'
}
