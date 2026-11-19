/**
 * The person page's library titles, from the rows the name match found and
 * the rows TMDb's credits added: their roles, the character played, their
 * order and the header counts. Pure (type imports only); pinned by
 * `personCredits.test.ts`.
 *
 * Which TMDb credits may add a title, and whether TMDb's person is the
 * library's at all, is core `discover/personTmdbCredits.ts`; the route passes
 * a title's TMDb credit here only once TMDb's person agrees with the library.
 */

import type { TmdbCreditMedia, TmdbTitleCredit } from '@aperture/core'

/** How the person is credited on a title, as the page groups it. */
export type PersonCreditKind = 'actor' | 'director' | 'producer' | 'writer' | 'creator'

const KINDS: ReadonlySet<string> = new Set<PersonCreditKind>(['actor', 'director', 'producer', 'writer', 'creator'])

export interface ContentItem {
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  genres: string[]
  communityRating: number | null
  role?: string // For actors - their role in this content
  /** Person page only: the TMDb id, so TMDb's credit roles can join the media server's. */
  tmdbId?: string | null
  /** Person page only: how the person is credited on this title (media server, then TMDb). */
  credits?: PersonCreditKind[]
}

/** A title row as the person route reads it; the flags are the media server's credits. */
export interface PersonCreditRow {
  id: string
  tmdb_id: string | null
  title: string
  year: number | null
  poster_url: string | null
  backdrop_url: string | null
  genres: string[] | null
  community_rating: number | null
  is_actor: boolean
  is_director: boolean
  is_writer: boolean
  is_creator: boolean
  role: string | null
}

/**
 * One library title for the page. `tmdbCredit` is TMDb's credit for the
 * person on this title (absent when TMDb was not consulted or does not
 * agree): its roles join the media server's, and its character stands in
 * when the media server names none.
 */
export function personCreditItem(row: PersonCreditRow, tmdbCredit?: TmdbTitleCredit): ContentItem {
  const kinds = new Set<PersonCreditKind>()
  if (row.is_actor) kinds.add('actor')
  if (row.is_director) kinds.add('director')
  if (row.is_writer) kinds.add('writer')
  if (row.is_creator) kinds.add('creator')
  for (const role of tmdbCredit?.roles ?? []) {
    if (KINDS.has(role)) kinds.add(role as PersonCreditKind)
  }
  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    title: row.title,
    year: row.year,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    genres: row.genres || [],
    communityRating: row.community_rating,
    role: row.role || tmdbCredit?.character || undefined,
    credits: [...kinds],
  }
}

/** The TMDb ids, for one media type, whose credit may add a title the name match missed. */
export function tmdbIdsThatAddTitles(
  byTitle: ReadonlyMap<string, TmdbTitleCredit>,
  media: TmdbCreditMedia
): string[] {
  return [...byTitle.values()]
    .filter((credit) => credit.media === media && credit.addsTitle)
    .map((credit) => credit.tmdbId)
}

/** Newest first, undated last, then by title; the one order for every person page. */
export function sortPersonCredits(items: readonly ContentItem[]): ContentItem[] {
  return [...items].sort((a, b) => {
    if (a.year !== b.year) {
      if (a.year == null) return 1
      if (b.year == null) return -1
      return b.year - a.year
    }
    return a.title.localeCompare(b.title)
  })
}

export interface PersonCreditStats {
  totalMovies: number
  totalSeries: number
  asActor: number
  asDirector: number
}

export function personCreditStats(
  movies: readonly ContentItem[],
  series: readonly ContentItem[]
): PersonCreditStats {
  const credited = (items: readonly ContentItem[], kind: PersonCreditKind) =>
    items.filter((item) => item.credits?.includes(kind)).length
  return {
    totalMovies: movies.length,
    totalSeries: series.length,
    asActor: credited(movies, 'actor') + credited(series, 'actor'),
    asDirector: credited(movies, 'director') + credited(series, 'director'),
  }
}
