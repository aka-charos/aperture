/**
 * The Next from here API's shapes, mirrored by hand from core's
 * `nextFromHere/index.ts` and `trails/index.ts` (the bundle never imports
 * core). Change them together.
 */

export type TrailEntityKind = 'person' | 'franchise' | 'company' | 'keyword'

export type TrailRole =
  | 'franchise'
  | 'director'
  | 'creator'
  | 'writer'
  | 'lead'
  | 'cinematographer'
  | 'composer'
  | 'editor'
  | 'actor'
  | 'keyword'
  | 'studio'
  | 'network'

export interface TrailTitle {
  /** `movie:<id>` or `series:<id>`. */
  ref: string
  type: 'movie' | 'series'
  id: string
  title: string
  year: number | null
  posterUrl: string | null
}

export interface TrailEntity {
  /** Stable across index rebuilds. */
  key: string
  kind: TrailEntityKind
  name: string
  photo: string | null
  /** Titles in the viewer's library carrying it. */
  titleCount: number
}

/** What joins two steps of a trail: a person or franchise, and its part on each side. */
export interface TrailLink extends TrailEntity {
  rolesFrom: TrailRole[]
  rolesTo: TrailRole[]
}

export interface TrailResponse {
  /** The trail's titles in the viewer's library, in order. */
  titles: TrailTitle[]
  /** links[i] joins titles[i] to titles[i + 1]: the strongest thing they share, or null. */
  links: (TrailLink | null)[]
}

export type NextReason =
  | { kind: 'feel'; rank: number }
  | { kind: 'shared'; entity: TrailEntity; rolesThere: TrailRole[]; rolesHere: TrailRole[] }
  | { kind: 'favourite'; entity: TrailEntity; rolesHere: TrailRole[]; liked: number; averageRating: number | null }
  | { kind: 'company'; entity: TrailEntity; finished: number; ratio: number }
  | { kind: 'themes'; entities: TrailEntity[] }

export interface NextItem {
  title: TrailTitle
  reasons: NextReason[]
}

export interface NextRowMember {
  title: TrailTitle
  roles: TrailRole[]
  /** Finished, started or rated: shown for context, never suggested. */
  seen: boolean
}

export interface NextPeopleRow {
  entity: TrailEntity
  /** The roles the start gives them. */
  rolesThere: TrailRole[]
  favourite: { liked: number; averageRating: number | null } | null
  company: { finished: number; ratio: number } | null
  /** Unseen first, best suggestion first; then seen, newest first. */
  members: NextRowMember[]
  more: number
  /** Of those, the unseen ones (what is left out once seen titles are hidden). */
  moreUnseen: number
  seenCount: number
  /** Every title of theirs in the library, the start left out. */
  total: number
}

export interface NextMapLink {
  from: string
  to: string
  entity: TrailEntity
  rolesFrom: TrailRole[]
  rolesTo: TrailRole[]
}

export interface NextFromHereResponse {
  start: TrailTitle | null
  close: NextItem[]
  people: NextPeopleRow[]
  /** The start's themes, studios and networks, each a row like a person's, rarest first. */
  moreRows: NextPeopleRow[]
  map: { refs: string[]; links: NextMapLink[] }
  starts: TrailTitle[]
}

/** `/api/next-from-here/summary`: the few best suggestions, for a title's own page. */
export interface NextSummaryResponse {
  start: TrailTitle
  items: NextItem[]
}

/** `/api/next-from-here/walk`: each step, and the person or franchise it went through (null: closeness alone). */
export interface NextWalkResponse {
  start: TrailTitle
  steps: Array<{ title: TrailTitle; via: TrailLink | null }>
}
