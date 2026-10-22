/**
 * The Next from here API's shapes, mirrored by hand from core's
 * `nextFromHere/index.ts` (the bundle never imports core). Change the two
 * together. Titles and entities are the Trails shapes, reused.
 */

import type { TrailEntity, TrailRole, TrailTitle } from '../trails/types'

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
  map: { refs: string[]; links: NextMapLink[] }
  starts: TrailTitle[]
}
