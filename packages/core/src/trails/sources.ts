/**
 * Library rows as Trails credits. Pure, pinned by trails.test.ts.
 *
 * What counts as a credit, per column:
 *
 * - **People**: directors, writers, cinematographers, composers and editors
 *   (films; enrichment fills the last three from TMDb), a show's creators, and
 *   the first MAX_BILLED_ACTORS billed actors — the first LEAD_BILLING of them
 *   as leads. A show's creators are read the way every other reader reads them,
 *   `directors` first and TMDb's `tmdb_creators` when the media server supplied
 *   none, which is almost always.
 * - **Franchise**: a film's TMDb collection, keyed by its id so two collections
 *   that share a name stay two.
 * - **Companies**: studios, and a show's network. One kind, so a film made by
 *   a company and a show it broadcasts are linked.
 * - **Keywords**: TMDb's, less the production meta-tags in IGNORED_KEYWORDS.
 */

import { LEAD_BILLING, MAX_BILLED_ACTORS, normalizeName, type LinkRole } from './rules.js'
import type { CreditSource, TitleSource } from './graph.js'

export interface MovieCreditRow {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  directors: string[] | null
  writers: string[] | null
  cinematographers: string[] | null
  composers: string[] | null
  editors: string[] | null
  actors: unknown
  keywords: string[] | null
  studios: unknown
  collection_id: string | null
  collection_name: string | null
}

export interface SeriesCreditRow {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  creators: string[] | null
  writers: string[] | null
  actors: unknown
  keywords: string[] | null
  studios: unknown
  network: string | null
}

/**
 * TMDb keywords that describe how a film was made or released rather than what
 * it is: "both have a post-credits scene" or "both are sequels" is true and
 * means nothing. The caps would drop them on a large library, where they sit on
 * hundreds of titles, but not on a small one, so they are left out by name.
 * Folded as `normalizeName` folds, so the check matches whatever casing TMDb
 * sends.
 */
export const IGNORED_KEYWORDS: ReadonlySet<string> = new Set([
  'duringcreditsstinger',
  'aftercreditsstinger',
  'post-credits scene',
  'mid-credits scene',
  'woman director',
  'sequel',
  'prequel',
  'remake',
  'reboot',
  'spin off',
  'independent film',
  'short film',
  '3d',
  'imax',
])

function keywordCredits(values: readonly unknown[] | null | undefined): CreditSource[] {
  return names(values, 'keyword').filter((credit) => !IGNORED_KEYWORDS.has(normalizeName(credit.name)))
}

function names(values: readonly unknown[] | null | undefined, role: LinkRole): CreditSource[] {
  if (!Array.isArray(values)) return []
  const credits: CreditSource[] = []
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) credits.push({ role, name: value })
  }
  return credits
}

/** Billed actors, leads first; entries without a name are skipped and do not use a billing slot. */
export function actorCredits(actors: unknown): CreditSource[] {
  if (!Array.isArray(actors)) return []
  const credits: CreditSource[] = []
  for (const actor of actors) {
    if (credits.length >= MAX_BILLED_ACTORS) break
    const record = actor as { name?: unknown; thumb?: unknown } | null
    const name = typeof record?.name === 'string' ? record.name : ''
    if (!name.trim()) continue
    credits.push({
      role: credits.length < LEAD_BILLING ? 'lead' : 'actor',
      name,
      photo: typeof record?.thumb === 'string' && record.thumb ? record.thumb : null,
    })
  }
  return credits
}

/** `studios` is JSONB `[{ name }]` since 0048; anything else is ignored. */
export function studioCredits(studios: unknown): CreditSource[] {
  if (!Array.isArray(studios)) return []
  const credits: CreditSource[] = []
  for (const studio of studios) {
    const name = (studio as { name?: unknown } | null)?.name
    if (typeof name === 'string' && name.trim()) credits.push({ role: 'studio', name })
  }
  return credits
}

export function movieSource(row: MovieCreditRow): TitleSource {
  const credits: CreditSource[] = [
    ...names(row.directors, 'director'),
    ...names(row.writers, 'writer'),
    ...names(row.cinematographers, 'cinematographer'),
    ...names(row.composers, 'composer'),
    ...names(row.editors, 'editor'),
    ...actorCredits(row.actors),
    ...keywordCredits(row.keywords),
    ...studioCredits(row.studios),
  ]
  if (row.collection_id && row.collection_name?.trim()) {
    credits.push({ role: 'franchise', name: row.collection_name, key: row.collection_id })
  }
  return { type: 'movie', id: row.id, title: row.title, year: row.year, posterUrl: row.poster_url, credits }
}

export function seriesSource(row: SeriesCreditRow): TitleSource {
  const credits: CreditSource[] = [
    ...names(row.creators, 'creator'),
    ...names(row.writers, 'writer'),
    ...actorCredits(row.actors),
    ...keywordCredits(row.keywords),
    ...studioCredits(row.studios),
  ]
  if (row.network?.trim()) credits.push({ role: 'network', name: row.network })
  return { type: 'series', id: row.id, title: row.title, year: row.year, posterUrl: row.poster_url, credits }
}
