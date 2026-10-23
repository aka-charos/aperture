/**
 * The trail on Next from here, and how a shared credit is worded: which
 * string, which values, never the text itself. Pure, pinned by next.test.ts.
 *
 * Kept from the retired Trails page, whose address (`/trails?trail=…`) now
 * redirects here with the same trail.
 */
import { CONNECTION_COLORS } from '../../components/SimilarityGraph/types'
import type { TrailEntityKind, TrailLink, TrailRole } from './types'

/**
 * Each kind in the similarity graph's legend colour for the same thing, read
 * from its palette so the map and the rows cannot drift apart.
 */
export const KIND_COLOR: Record<TrailEntityKind, string> = {
  person: CONNECTION_COLORS.director,
  franchise: CONNECTION_COLORS.collection,
  company: CONNECTION_COLORS.studio,
  keyword: CONNECTION_COLORS.keyword,
}

/** The kinds a row can be, in the order the filter chips offer them. */
export const ROW_KINDS: readonly TrailEntityKind[] = ['person', 'franchise', 'company', 'keyword']

/** The i18n key of a role's name: "Director", "Lead", "Cinematographer"… */
export function roleKey(role: TrailRole): string {
  return `next.roles.${role}`
}

/**
 * What a step's link says about the two titles. Roles arrive strongest first,
 * so the first of each side is the one worth naming. A franchise and a keyword
 * carry no role worth naming, so they get a sentence of their own.
 */
export type StepCaption =
  | { key: 'next.caption.franchise' }
  | { key: 'next.caption.keyword' }
  | { key: 'next.caption.same'; role: TrailRole }
  | { key: 'next.caption.differs'; from: TrailRole; to: TrailRole }

export function stepCaption(link: Pick<TrailLink, 'kind' | 'rolesFrom' | 'rolesTo'>): StepCaption {
  if (link.kind === 'franchise') return { key: 'next.caption.franchise' }
  if (link.kind === 'keyword') return { key: 'next.caption.keyword' }
  const from = link.rolesFrom[0]
  const to = link.rolesTo[0]
  if (!from || !to) return { key: 'next.caption.same', role: from ?? to ?? 'actor' }
  return from === to ? { key: 'next.caption.same', role: from } : { key: 'next.caption.differs', from, to }
}

/** What a row's entity is in the start. */
export type HereCaption =
  | { key: 'next.here.franchise' }
  | { key: 'next.here.keyword' }
  | { key: 'next.here.role'; role: TrailRole }

export function hereCaption(kind: TrailEntityKind, roles: readonly TrailRole[]): HereCaption {
  if (kind === 'franchise') return { key: 'next.here.franchise' }
  if (kind === 'keyword') return { key: 'next.here.keyword' }
  return { key: 'next.here.role', role: roles[0] ?? 'actor' }
}

const REF = /^(movie|series):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTitleRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value)
}

/** A library title's ref, or null for an id the API would not accept. */
export function titleRefFor(type: 'movie' | 'series', id: string): string | null {
  const ref = `${type}:${id}`.toLowerCase()
  return isTitleRef(ref) ? ref : null
}

/** Refs from a comma-separated value: malformed ones dropped, repeats kept once, the newest `max` kept. */
export function readRefList(value: string | null, max: number): string[] {
  if (!value) return []
  const refs: string[] = []
  for (const part of value.split(',')) {
    const ref = part.trim()
    if (isTitleRef(ref) && !refs.includes(ref.toLowerCase())) refs.push(ref.toLowerCase())
  }
  return refs.slice(-max)
}

/**
 * The trail after stepping to `ref`: going back to a title already on it cuts
 * the trail there rather than looping, and the oldest falls off once it is
 * longer than `max`.
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

/** The key a link between two consecutive titles of a trail is remembered by. */
export function pairKey(from: string, to: string): string {
  return `${from}>${to}`
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

