/**
 * How Trails words a link, and how the page's selection lives in the URL.
 * Pure, pinned by trails.test.ts.
 */
import { CONNECTION_COLORS } from '../../components/SimilarityGraph/types'
import type { TrailEntityKind, TrailLink, TrailRole } from './types'

/**
 * Each kind in the similarity graph's legend colour for the same thing, read
 * from its palette so the two pages cannot drift apart.
 */
export const KIND_COLOR: Record<TrailEntityKind, string> = {
  person: CONNECTION_COLORS.director,
  franchise: CONNECTION_COLORS.collection,
  company: CONNECTION_COLORS.studio,
  keyword: CONNECTION_COLORS.keyword,
}

/** The i18n key of a role's name: "Director", "Lead", "Cinematographer"… */
export function roleKey(role: TrailRole): string {
  return `trails.roles.${role}`
}

/**
 * What a step's link says about the two titles. Roles arrive strongest first,
 * so the first of each side is the one worth naming. A franchise and a keyword
 * carry no role worth naming, so they get a sentence of their own.
 */
export type StepCaption =
  | { key: 'trails.caption.franchise' }
  | { key: 'trails.caption.keyword' }
  | { key: 'trails.caption.same'; role: TrailRole }
  | { key: 'trails.caption.differs'; from: TrailRole; to: TrailRole }

export function stepCaption(link: Pick<TrailLink, 'kind' | 'rolesFrom' | 'rolesTo'>): StepCaption {
  if (link.kind === 'franchise') return { key: 'trails.caption.franchise' }
  if (link.kind === 'keyword') return { key: 'trails.caption.keyword' }
  const from = link.rolesFrom[0]
  const to = link.rolesTo[0]
  if (!from || !to) return { key: 'trails.caption.same', role: from ?? to ?? 'actor' }
  return from === to ? { key: 'trails.caption.same', role: from } : { key: 'trails.caption.differs', from, to }
}

/** What a thread's entity is in the title it starts from. */
export type HereCaption =
  | { key: 'trails.here.franchise' }
  | { key: 'trails.here.keyword' }
  | { key: 'trails.here.role'; role: TrailRole }

export function hereCaption(kind: TrailEntityKind, roles: readonly TrailRole[]): HereCaption {
  if (kind === 'franchise') return { key: 'trails.here.franchise' }
  if (kind === 'keyword') return { key: 'trails.here.keyword' }
  return { key: 'trails.here.role', role: roles[0] ?? 'actor' }
}

/**
 * How rare a link is, as a count the reader can check: true without any
 * calibration, which a "rare"/"common" band would not be.
 */
export function rarityText(titleCount: number): { key: 'trails.rarity.onlyTwo' } | { key: 'trails.rarity.count'; count: number } {
  return titleCount <= 2 ? { key: 'trails.rarity.onlyTwo' } : { key: 'trails.rarity.count', count: titleCount }
}

// ---------------------------------------------------------------------------
// The selection in the URL
// ---------------------------------------------------------------------------

export type TrailsMode = 'route' | 'threads' | 'common'

export const TRAILS_MODES: readonly TrailsMode[] = ['route', 'threads', 'common']

/** How many titles the followed trail remembers; older ones fall off the front. */
export const MAX_TRAIL_LENGTH = 12

export interface TrailsUrlState {
  mode: TrailsMode
  from: string | null
  to: string | null
  /** Titles followed in Follow a thread, oldest first; the last is the current one. */
  trail: string[]
  /** Titles compared in In common. */
  titles: string[]
}

const REF = /^(movie|series):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTitleRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value)
}

function readRef(value: string | null): string | null {
  return value && isTitleRef(value) ? value.toLowerCase() : null
}

/** Refs from a comma-separated value: malformed ones dropped, repeats kept once, capped. */
function readRefList(value: string | null, max: number): string[] {
  if (!value) return []
  const refs: string[] = []
  for (const part of value.split(',')) {
    const ref = readRef(part.trim())
    if (ref && !refs.includes(ref)) refs.push(ref)
  }
  return refs.slice(-max)
}

export function readTrailsUrl(params: URLSearchParams, maxCommonTitles: number): TrailsUrlState {
  const mode = params.get('mode')
  return {
    mode: TRAILS_MODES.includes(mode as TrailsMode) ? (mode as TrailsMode) : 'route',
    from: readRef(params.get('from')),
    to: readRef(params.get('to')),
    trail: readRefList(params.get('trail'), MAX_TRAIL_LENGTH),
    titles: readRefList(params.get('titles'), maxCommonTitles),
  }
}

/**
 * The state as URL parameters. Every mode's selection is kept, so switching
 * tab and back finds the titles where they were; an empty value is left out.
 */
export function writeTrailsUrl(state: TrailsUrlState): URLSearchParams {
  const params = new URLSearchParams()
  params.set('mode', state.mode)
  if (state.from) params.set('from', state.from)
  if (state.to) params.set('to', state.to)
  if (state.trail.length > 0) params.set('trail', state.trail.join(','))
  if (state.titles.length > 0) params.set('titles', state.titles.join(','))
  return params
}

/**
 * The followed trail after stepping to `ref`: going back to a title already on
 * it cuts the trail there rather than looping, and the oldest falls off once
 * it is long.
 */
export function stepTrail(trail: readonly string[], ref: string): string[] {
  const at = trail.indexOf(ref)
  if (at >= 0) return trail.slice(0, at + 1)
  return [...trail, ref].slice(-MAX_TRAIL_LENGTH)
}
