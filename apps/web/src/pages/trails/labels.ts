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

export const TRAIL_KINDS: readonly TrailEntityKind[] = ['person', 'franchise', 'company', 'keyword']

export interface TrailsUrlState {
  /** Titles followed, oldest first; the last is the one the threads lead out of. */
  trail: string[]
  /** Leave out titles the viewer has watched. */
  hideWatched: boolean
  /** Only these kinds of thread; empty means every kind. */
  kinds: TrailEntityKind[]
}

const REF = /^(movie|series):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTitleRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value)
}

function readRef(value: string | null): string | null {
  return value && isTitleRef(value) ? value.toLowerCase() : null
}

/** Refs from a comma-separated value: malformed ones dropped, repeats kept once, the newest `max` kept. */
export function readRefList(value: string | null, max: number): string[] {
  if (!value) return []
  const refs: string[] = []
  for (const part of value.split(',')) {
    const ref = readRef(part.trim())
    if (ref && !refs.includes(ref)) refs.push(ref)
  }
  return refs.slice(-max)
}

function readKinds(value: string | null): TrailEntityKind[] {
  if (!value) return []
  const wanted = new Set(value.split(','))
  // In the page's own order, so one selection has one address.
  return TRAIL_KINDS.filter((kind) => wanted.has(kind))
}

/**
 * The page's state from its address. `maxTrail` is the API's limit, or no cap
 * before it arrives. Parameters this page no longer reads (the retired
 * `mode`, `from`, `to`, `titles`) are ignored, so an old link still opens its
 * trail.
 */
export function readTrailsUrl(params: URLSearchParams, maxTrail = Number.MAX_SAFE_INTEGER): TrailsUrlState {
  return {
    trail: readRefList(params.get('trail'), maxTrail),
    hideWatched: params.get('unwatched') === '1',
    kinds: readKinds(params.get('kinds')),
  }
}

/** The state as URL parameters; an empty or default value is left out. */
export function writeTrailsUrl(state: TrailsUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.trail.length > 0) params.set('trail', state.trail.join(','))
  if (state.hideWatched) params.set('unwatched', '1')
  const kinds = TRAIL_KINDS.filter((kind) => state.kinds.includes(kind))
  if (kinds.length > 0 && kinds.length < TRAIL_KINDS.length) params.set('kinds', kinds.join(','))
  return params
}

/** The API query for the state's filters: `unwatched` and `kinds`, as the page writes them. */
export function filterQuery(state: Pick<TrailsUrlState, 'hideWatched' | 'kinds'>): string {
  const params = writeTrailsUrl({ trail: [], ...state })
  const query = params.toString()
  return query ? `&${query}` : ''
}

/**
 * The followed trail after stepping to `ref`: going back to a title already on
 * it cuts the trail there rather than looping, and the oldest falls off once
 * it is longer than `max`.
 */
export function stepTrail(trail: readonly string[], ref: string, max = Number.MAX_SAFE_INTEGER): string[] {
  const at = trail.indexOf(ref)
  if (at >= 0) return trail.slice(0, at + 1)
  return [...trail, ref].slice(-max)
}

/** The trail with several titles walked onto its end, in order. */
export function extendTrail(trail: readonly string[], refs: readonly string[], max = Number.MAX_SAFE_INTEGER): string[] {
  return refs.reduce<string[]>((current, ref) => stepTrail(current, ref, max), [...trail])
}

/**
 * Whether the page must ask `/trail` about a trail: some title on it has no
 * card yet, or two titles that sit side by side once the unknown ones are left
 * out have no link yet. `gone` holds the refs a lookup asked about and the API
 * did not return (out of scope, deleted): the strip leaves them out and links
 * the titles either side, so they are neither a missing card nor a missing pair
 * — or every later step would ask about the whole trail again.
 */
export function trailLookupNeeded(
  refs: readonly string[],
  hasCard: (ref: string) => boolean,
  hasLink: (key: string) => boolean,
  gone: ReadonlySet<string>
): boolean {
  const kept = refs.filter((ref) => !gone.has(ref))
  if (kept.some((ref) => !hasCard(ref))) return true
  return kept.slice(1).some((ref, i) => !hasLink(pairKey(kept[i], ref)))
}

/** The key a link between two consecutive titles of a trail is remembered by. */
export function pairKey(from: string, to: string): string {
  return `${from}>${to}`
}

/** A library title's ref, or null for an id Trails would not accept. */
export function titleRefFor(type: 'movie' | 'series', id: string): string | null {
  const ref = `${type}:${id}`.toLowerCase()
  return isTitleRef(ref) ? ref : null
}

/**
 * The Trails address that starts a trail at one title, for links into the
 * page from elsewhere (a title's detail page). Built through `writeTrailsUrl`
 * so it reads back exactly as the page writes its own state.
 *
 * `current` is the Trails page's own query when the link is followed from on
 * top of it (a title opened in its dialog): the filters are kept and only the
 * trail starts again.
 */
export function trailPathFor(ref: string, current?: URLSearchParams | null): string {
  const kept = current ? readTrailsUrl(current) : { trail: [], hideWatched: false, kinds: [] }
  const query = writeTrailsUrl({ ...kept, trail: [ref] }).toString()
  return `/trails?${query}`
}

/**
 * How many OTHER titles in the library share a thread. A thread's `titleCount`
 * includes the title it starts from, and a page showing only that title (its
 * detail page) cannot say "these two".
 */
export function sharedWithOthers(titleCount: number): { key: 'trails.detail.sharedWith'; count: number } {
  return { key: 'trails.detail.sharedWith', count: Math.max(1, titleCount - 1) }
}
