/**
 * How Next from here words a reason: the decisions only (which string, which
 * values), so they can be pinned without rendering. The page turns them into
 * text with `t()`. Pinned by next.test.ts.
 */

import { isTitleRef } from '../trails/labels'
import type { TrailRole } from '../trails/types'
import type { NextReason } from './types'

export type ReasonText =
  | { key: 'next.reason.feelClosestMovie' | 'next.reason.feelClosestSeries'; start: string }
  | { key: 'next.reason.feelMovie' | 'next.reason.feelSeries'; start: string; rank: number }
  | { key: 'next.reason.sharedSame'; name: string; role: TrailRole }
  | { key: 'next.reason.sharedDiffers'; name: string; there: TrailRole; here: TrailRole; start: string }
  | { key: 'next.reason.franchise'; name: string }
  | { key: 'next.reason.favouriteRated'; name: string; role: TrailRole; count: number; average: number }
  | { key: 'next.reason.favourite'; name: string; role: TrailRole; count: number }
  | { key: 'next.reason.companyMovies' | 'next.reason.companySeries'; name: string; ratio: number; count: number }

/**
 * Most telling first: a named person or franchise shared with the start,
 * then a favourite, then a studio or network, and "close in feel" last —
 * true of every title in the close list, so it says the least about any one.
 */
const ORDER: Record<NextReason['kind'], number> = { shared: 0, favourite: 1, company: 2, feel: 3 }

export function orderReasons(reasons: readonly NextReason[]): NextReason[] {
  return [...reasons].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
}

export function reasonText(reason: NextReason, start: string, type: 'movie' | 'series'): ReasonText {
  switch (reason.kind) {
    // The rank is among neighbours of the suggestion's own type (core ranks
    // films and shows apart), so the wording names which.
    case 'feel':
      return reason.rank <= 1
        ? { key: type === 'movie' ? 'next.reason.feelClosestMovie' : 'next.reason.feelClosestSeries', start }
        : { key: type === 'movie' ? 'next.reason.feelMovie' : 'next.reason.feelSeries', start, rank: reason.rank }
    case 'shared': {
      if (reason.entity.kind === 'franchise') return { key: 'next.reason.franchise', name: reason.entity.name }
      const there = reason.rolesThere[0]
      const here = reason.rolesHere[0]
      return there === here || !there || !here
        ? { key: 'next.reason.sharedSame', name: reason.entity.name, role: here ?? there }
        : { key: 'next.reason.sharedDiffers', name: reason.entity.name, there, here, start }
    }
    case 'favourite':
      return reason.averageRating != null
        ? {
            key: 'next.reason.favouriteRated',
            name: reason.entity.name,
            role: reason.rolesHere[0],
            count: reason.liked,
            average: reason.averageRating,
          }
        : { key: 'next.reason.favourite', name: reason.entity.name, role: reason.rolesHere[0], count: reason.liked }
    case 'company':
      return {
        key: type === 'movie' ? 'next.reason.companyMovies' : 'next.reason.companySeries',
        name: reason.entity.name,
        ratio: reason.ratio,
        count: reason.finished,
      }
  }
}

/** `?title=movie:<uuid>` read back (Trails' ref format); anything else is no start. */
export function readStartParam(params: URLSearchParams): string | null {
  const raw = params.get('title')?.trim()
  return isTitleRef(raw) ? raw.toLowerCase() : null
}
