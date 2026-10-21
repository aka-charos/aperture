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

export type NextQuadrant = 'close' | 'closeLinked' | 'linkedDifferent'

export interface NextItem {
  title: TrailTitle
  quadrant: NextQuadrant
  reasons: NextReason[]
}

export interface NextFromHereResponse {
  start: TrailTitle | null
  close: NextItem[]
  different: NextItem[]
  starts: TrailTitle[]
}
