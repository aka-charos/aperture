/**
 * The TV Gap Analysis listing, as pure functions. The server decides each season's
 * standing and whether it can be requested; everything here only narrows and orders
 * what it sent.
 */

import { foldForSearch, type GapSort } from './listing'

export type SeasonStanding = 'owned' | 'missing' | 'partial' | 'seerr' | 'requested' | 'unclear'

export interface SeriesGapSeason {
  seasonNumber: number
  airDate: string | null
  posterPath: string | null
  airedEpisodes: number
  heldEpisodes: number
  standing: SeasonStanding
  requestable: boolean
}

export interface SeriesGapShow {
  tmdbId: number
  title: string
  posterPath: string | null
  networks: string[]
  libraryId: string | null
  /** The library row's rating as every surface shows it; null = unrated. */
  rating: number | null
  /** Stored (English) genre names; drawn through `genreLabel`. */
  genres: string[]
  numberingDiffers: boolean
  seasons: SeriesGapSeason[]
  total: number
  owned: number
  missing: number
  partial: number
  pending: number
}

/**
 * `missing` is the default because it is the question asked and the sure answer. A
 * partly held season can be a real gap, or two episodes in one file, which the library
 * counts as one; `numbering` lists the shows whose gaps could not be trusted at all.
 */
export const SERIES_GAP_KINDS = ['missing', 'partial', 'both', 'numbering'] as const
export type SeriesGapKind = (typeof SERIES_GAP_KINDS)[number]

/** The network filter's entry for a show neither TMDb nor the media server names one for. */
export const NO_NETWORK = '__none__'

/** Open gaps of this kind. */
export function gapCount(show: SeriesGapShow, kind: SeriesGapKind): number {
  switch (kind) {
    case 'missing':
      return show.missing
    case 'partial':
      return show.partial
    case 'both':
      return show.missing + show.partial
    default:
      return 0
  }
}

export function matchesKind(show: SeriesGapShow, kind: SeriesGapKind): boolean {
  return kind === 'numbering' ? show.numberingDiffers : gapCount(show, kind) > 0
}

export function matchesNetworks(show: SeriesGapShow, selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  if (show.networks.length === 0) return selected.includes(NO_NETWORK)
  return show.networks.some((n) => selected.includes(n))
}

export function showMatchesSearch(show: SeriesGapShow, query: string): boolean {
  const q = foldForSearch(query.trim())
  return !q || foldForSearch(show.title).includes(q)
}

export interface NetworkOption {
  name: string
  count: number
}

/**
 * Every network among `shows`, most shows first. A selected network the other
 * filters have emptied stays listed at 0, so it can still be seen and removed.
 */
export function networkOptions(shows: readonly SeriesGapShow[], selected: readonly string[] = []): NetworkOption[] {
  const counts = new Map<string, number>()
  for (const name of selected) counts.set(name, 0)
  for (const show of shows) {
    for (const name of show.networks.length > 0 ? show.networks : [NO_NETWORK]) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Same reading as the movie list: `closest` puts the shows one season from done first. */
export function sortSeriesGaps(
  shows: readonly SeriesGapShow[],
  sort: GapSort,
  kind: SeriesGapKind
): SeriesGapShow[] {
  const byName = (a: SeriesGapShow, b: SeriesGapShow) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const closed = (s: SeriesGapShow) => (s.total > 0 ? (s.total - gapCount(s, kind)) / s.total : 0)

  const compare =
    sort === 'name'
      ? byName
      : sort === 'mostMissing'
        ? (a: SeriesGapShow, b: SeriesGapShow) => gapCount(b, kind) - gapCount(a, kind) || byName(a, b)
        : (a: SeriesGapShow, b: SeriesGapShow) =>
            closed(b) - closed(a) || gapCount(a, kind) - gapCount(b, kind) || b.owned - a.owned || byName(a, b)
  return [...shows].sort(compare)
}

export function seasonKey(tmdbId: number, seasonNumber: number): string {
  return `${tmdbId}:${seasonNumber}`
}

/** What a row's Request button and checkbox act on: this filter's seasons, not all of them. */
export function requestableSeasons(show: SeriesGapShow, kind: SeriesGapKind): SeriesGapSeason[] {
  return show.seasons.filter(
    (s) => s.requestable && (kind === 'both' || s.standing === kind)
  )
}

export interface SeriesRequestItem {
  tmdbId: number
  mediaType: 'series'
  title: string
  seasons: number[]
}

/** One item per show: Seerr takes a show's seasons together in one request. */
export function buildSeriesRequestItems(
  shows: readonly SeriesGapShow[],
  keys: ReadonlySet<string>
): SeriesRequestItem[] {
  const items: SeriesRequestItem[] = []
  for (const show of shows) {
    const seasons = show.seasons
      .filter((s) => s.requestable && keys.has(seasonKey(show.tmdbId, s.seasonNumber)))
      .map((s) => s.seasonNumber)
    if (seasons.length > 0) {
      items.push({ tmdbId: show.tmdbId, mediaType: 'series', title: show.title, seasons })
    }
  }
  return items
}
