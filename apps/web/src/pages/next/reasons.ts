/**
 * How Next from here words its reasons and keeps its state: the decisions only
 * (which string, which values, which address), so they can be pinned without
 * rendering. The page turns them into text with `t()`. Pinned by next.test.ts.
 */

import { ROW_KINDS, readRefList } from './trail'
import type { NextItem, NextPeopleRow, NextReason, NextRowMember, TrailEntityKind, TrailLink, TrailRole } from './types'

export type ReasonText =
  | { key: 'next.reason.feelClosestMovie' | 'next.reason.feelClosestSeries'; start: string }
  | { key: 'next.reason.feelMovie' | 'next.reason.feelSeries'; start: string; rank: number }
  | { key: 'next.reason.sharedSame'; name: string; role: TrailRole }
  | { key: 'next.reason.sharedDiffers'; name: string; there: TrailRole; here: TrailRole; start: string }
  | { key: 'next.reason.franchise'; name: string }
  | { key: 'next.reason.favouriteRated'; name: string; role: TrailRole; count: number; average: number }
  | { key: 'next.reason.favourite'; name: string; role: TrailRole; count: number }
  | { key: 'next.reason.companyMovies' | 'next.reason.companySeries'; name: string; ratio: number; count: number }
  | { key: 'next.reason.themes'; names: string[] }

/**
 * Most telling first: a named person or franchise shared with the start,
 * then a favourite, then the themes the two share, then a studio or network,
 * and "close in feel" last — true of every title in the close list, so it
 * says the least about any one.
 */
const ORDER: Record<NextReason['kind'], number> = { shared: 0, favourite: 1, themes: 2, company: 3, feel: 4 }

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
    case 'themes':
      return { key: 'next.reason.themes', names: reason.entities.map((entity) => entity.name) }
  }
}

// ---------------------------------------------------------------------------
// The people rows
// ---------------------------------------------------------------------------

export type RowNote =
  | { key: 'next.row.favouriteRated'; count: number; average: number }
  | { key: 'next.row.favourite'; count: number }
  | { key: 'next.row.companyMovies' | 'next.row.companySeries'; ratio: number; count: number }
  | { key: 'next.row.seenSome'; seen: number; total: number }
  | { key: 'next.row.seenNone'; total: number }

/**
 * The line under a row's name: what the viewer's own record says of them
 * when it says something (the reason the row sits where it does), else how
 * much of their work the viewer has seen. `type` is the start's media type,
 * the one a company's skew was measured in.
 */
export function rowNote(row: NextPeopleRow, type: 'movie' | 'series'): RowNote {
  if (row.favourite) {
    return row.favourite.averageRating != null
      ? { key: 'next.row.favouriteRated', count: row.favourite.liked, average: row.favourite.averageRating }
      : { key: 'next.row.favourite', count: row.favourite.liked }
  }
  if (row.company) {
    return {
      key: type === 'movie' ? 'next.row.companyMovies' : 'next.row.companySeries',
      ratio: row.company.ratio,
      count: row.company.finished,
    }
  }
  return row.seenCount > 0
    ? { key: 'next.row.seenSome', seen: row.seenCount, total: row.total }
    : { key: 'next.row.seenNone', total: row.total }
}

/**
 * A franchise entity's TMDb collection id, from its stable key
 * (`franchise:#<id>`, core trails/graph.ts), for its page; null otherwise.
 */
export function franchiseIdFromKey(key: string): string | null {
  const match = /^franchise:#(\d+)$/.exec(key)
  return match ? match[1] : null
}

/** A row's titles as shown: all of them, or only the unseen when the viewer hides what they have seen. */
export function rowMembers(row: NextPeopleRow, hideSeen: boolean): NextRowMember[] {
  return hideSeen ? row.members.filter((member) => !member.seen) : row.members
}

// ---------------------------------------------------------------------------
// Stepping on: the trail
// ---------------------------------------------------------------------------

/**
 * What joins the start to a suggestion stepped to, for the trail strip: the
 * strongest person or franchise they share, or null when they share no one
 * (the strip then draws a plain arrow — close in feel, nothing named).
 */
export function itemLink(item: NextItem): TrailLink | null {
  const shared = item.reasons.find((reason) => reason.kind === 'shared')
  if (!shared || shared.kind !== 'shared') return null
  return { ...shared.entity, rolesFrom: shared.rolesThere, rolesTo: shared.rolesHere }
}

/** What joins the start to a title stepped to from one of its rows: the row's person itself. */
export function rowLink(row: NextPeopleRow, member: NextRowMember): TrailLink {
  return { ...row.entity, rolesFrom: row.rolesThere, rolesTo: member.roles }
}

export type NextView = 'list' | 'map'

export interface NextUrlState {
  /** Titles stepped through, oldest first; the last is the start. Empty: the API chooses. */
  trail: string[]
  view: NextView
  /** Leave the viewer's seen titles out of the rows (suggestions never hold them). */
  hideSeen: boolean
  /** Only rows of these kinds; empty means every kind. */
  kinds: TrailEntityKind[]
}

function readKinds(value: string | null): TrailEntityKind[] {
  if (!value) return []
  const wanted = new Set(value.split(','))
  // In the chips' own order, so one selection has one address.
  return ROW_KINDS.filter((kind) => wanted.has(kind))
}

/**
 * The page's state from its address. `trail` drops malformed refs, keeps
 * repeats once and keeps the newest `maxTrail`; `?title=` (what a title page
 * links with) reads as a trail of one.
 */
export function readNextUrl(params: URLSearchParams, maxTrail = Number.MAX_SAFE_INTEGER): NextUrlState {
  const trail = readRefList(params.get('trail'), maxTrail)
  return {
    trail: trail.length > 0 ? trail : readRefList(params.get('title'), 1),
    view: params.get('view') === 'map' ? 'map' : 'list',
    hideSeen: params.get('hide') === 'seen',
    kinds: readKinds(params.get('kinds')),
  }
}

/** The state as URL parameters; defaults are left out, so one state has one address. */
export function writeNextUrl(state: NextUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.trail.length === 1) params.set('title', state.trail[0])
  else if (state.trail.length > 1) params.set('trail', state.trail.join(','))
  if (state.view === 'map') params.set('view', 'map')
  if (state.hideSeen) params.set('hide', 'seen')
  const kinds = ROW_KINDS.filter((kind) => state.kinds.includes(kind))
  // Every kind chosen is no filter, so it is written as none.
  if (kinds.length > 0 && kinds.length < ROW_KINDS.length) params.set('kinds', kinds.join(','))
  return params
}

/** Whether a row shows under the chosen kinds (none chosen shows every row). */
export function rowShown(row: Pick<NextPeopleRow, 'entity'>, kinds: readonly TrailEntityKind[]): boolean {
  return kinds.length === 0 || kinds.includes(row.entity.kind)
}

/** The address a title's own page links to: Next from here, starting at it. */
export function nextPath(ref: string): string {
  return `/next?${writeNextUrl({ trail: [ref], view: 'list', hideSeen: false, kinds: [] }).toString()}`
}

/**
 * The Next from here address for an old Trails one (`/trails?trail=…`): the
 * same trail. The retired filters are dropped — Next leaves out what the
 * viewer has seen by itself, and Trails' kinds filtered threads, not rows.
 */
export function nextPathFromTrails(params: URLSearchParams): string {
  const trail = readRefList(params.get('trail'), Number.MAX_SAFE_INTEGER)
  const query = writeNextUrl({ trail, view: 'list', hideSeen: false, kinds: [] }).toString()
  return query ? `/next?${query}` : '/next'
}

/** The API query for a trail: its last title is the start, the rest are never suggested again. */
export function nextQuery(trail: readonly string[]): string {
  if (trail.length === 0) return ''
  const params = new URLSearchParams({ title: trail[trail.length - 1] })
  if (trail.length > 1) params.set('avoid', trail.slice(0, -1).join(','))
  return `?${params.toString()}`
}
