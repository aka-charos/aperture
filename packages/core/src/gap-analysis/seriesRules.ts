/**
 * What one TV season is to this library, decided once.
 *
 * The scan compares TMDb's seasons with the episodes the library holds and stores
 * the comparison; a read adds what has happened since (a request sent from the page)
 * and ships each season's standing decided. Pure, so the rules are pinned by a test.
 */

import { isReleasedReleaseDate, type SeerrStatus } from '../tmdb/collectionParts.js'

export interface TmdbSeason {
  season_number: number
  episode_count: number
  air_date: string | null
  poster_path?: string | null
}

export interface TmdbLastEpisode {
  season_number: number
  episode_number: number
}

export type SeasonHolding = 'complete' | 'partial' | 'missing'

export interface ComparedSeason {
  seasonNumber: number
  airDate: string | null
  posterPath: string | null
  airedEpisodes: number
  heldEpisodes: number
  holding: SeasonHolding
}

export interface StoredSeason extends ComparedSeason {
  seerrStatus: SeerrStatus
}

/**
 * How many of a season's episodes have aired. TMDb's `episode_count` includes
 * announced episodes, and a season's date is only its premiere, so an airing season
 * is cut at `last_episode_to_air`. A season after that one has not started, whatever
 * its date says; TMDb lists next year's season with no episodes or a placeholder.
 * A season before it has aired, even undated, which TMDb leaves some old seasons. A
 * special as the latest episode says nothing about regular seasons, so it cuts nothing.
 */
export function airedEpisodes(
  season: TmdbSeason,
  last: TmdbLastEpisode | null | undefined,
  now: Date = new Date()
): number {
  if (season.episode_count <= 0) return 0
  const cutoff = last && last.season_number > 0 ? last : null
  if (cutoff && season.season_number < cutoff.season_number) return season.episode_count
  if (!isReleasedReleaseDate(season.air_date, now)) return 0
  if (!cutoff) return season.episode_count
  if (season.season_number > cutoff.season_number) return 0
  return Math.min(cutoff.episode_number, season.episode_count)
}

/**
 * Every aired regular season against what the library holds. Specials (season 0) are
 * left out on both sides, as everywhere else that counts a show's episodes.
 *
 * `numberingDiffers` is the guard against a false claim. Emby usually numbers from
 * TheTVDB and TMDb can cut the same episodes differently, so "season 3 is missing"
 * can really mean "your season 2 holds it". Two signs: the library holds a season
 * TMDb does not list, or a season with more episodes than TMDb gives it. Either one
 * only matters when the comparison found a gap, since it is the gap being doubted.
 */
export function compareShowSeasons(input: {
  seasons: readonly TmdbSeason[]
  lastEpisode?: TmdbLastEpisode | null
  held: ReadonlyMap<number, number>
  now?: Date
}): { seasons: ComparedSeason[]; numberingDiffers: boolean } {
  const regular = input.seasons.filter((s) => s.season_number > 0)
  const listed = new Set(regular.map((s) => s.season_number))

  const seasons: ComparedSeason[] = []
  for (const season of regular) {
    const aired = airedEpisodes(season, input.lastEpisode, input.now)
    if (aired === 0) continue
    const held = input.held.get(season.season_number) ?? 0
    seasons.push({
      seasonNumber: season.season_number,
      airDate: season.air_date,
      posterPath: season.poster_path ?? null,
      airedEpisodes: aired,
      heldEpisodes: held,
      holding: held === 0 ? 'missing' : held >= aired ? 'complete' : 'partial',
    })
  }
  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

  const hasGap = seasons.some((s) => s.holding !== 'complete')
  const heldUnlisted = [...input.held].some(([n, count]) => n > 0 && count > 0 && !listed.has(n))
  const overfull = regular.some((s) => (input.held.get(s.season_number) ?? 0) > s.episode_count)

  return { seasons, numberingDiffers: hasGap && (heldUnlisted || overfull) }
}

/**
 * Which networks to file a show under. TMDb's list is the real one and can name
 * several. The media server's value is its first studio, which is often a production
 * company, so it is used only when TMDb lists none.
 */
export function showNetworks(
  tmdbNetworks: readonly { name?: string | null }[] | null | undefined,
  libraryNetwork: string | null | undefined
): string[] {
  const names = (tmdbNetworks ?? []).map((n) => n.name?.trim()).filter((n): n is string => !!n)
  if (names.length > 0) return [...new Set(names)]
  const fallback = libraryNetwork?.trim()
  return fallback ? [fallback] : []
}

/** A request still in flight: `seasons` null means the whole show. */
export interface ActiveSeriesRequest {
  seasons: number[] | null
}

export function seasonIsRequested(seasonNumber: number, active: readonly ActiveSeriesRequest[]): boolean {
  return active.some((r) => r.seasons == null || r.seasons.includes(seasonNumber))
}

/** What is left to send, so a second selection cannot ask twice for one season. */
export function seasonsStillToRequest(
  requested: readonly number[],
  active: readonly ActiveSeriesRequest[]
): number[] {
  return requested.filter((n) => !seasonIsRequested(n, active))
}

/** Distinct regular season numbers, or null when the input is not a list of them. */
export function readRequestedSeasons(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length === 0) return null
  if (!input.every((n) => Number.isInteger(n) && n > 0)) return null
  return [...new Set(input as number[])].sort((a, b) => a - b)
}

export type SeasonStanding = 'owned' | 'missing' | 'partial' | 'seerr' | 'requested' | 'unclear'

/**
 * Order matters:
 *
 * 1. A complete season is owned, whatever else is true of the show.
 * 2. Doubted numbering claims nothing and offers nothing.
 * 3. In Seerr's pipeline at scan time, or requested since: on its way.
 * 4. A missing season Seerr calls available is a library sync away from here.
 * 5. A partly held season Seerr calls available stays a gap, but Seerr refuses to
 *    take a request for any season it has a status for, so no button.
 */
export function decideSeasonStanding(
  season: Pick<StoredSeason, 'holding' | 'seerrStatus'>,
  context: { numberingDiffers: boolean; requestedNow: boolean }
): { standing: SeasonStanding; requestable: boolean } {
  if (season.holding === 'complete') return { standing: 'owned', requestable: false }
  if (context.numberingDiffers) return { standing: 'unclear', requestable: false }
  if (season.seerrStatus === 'requested' || season.seerrStatus === 'processing') {
    return { standing: 'seerr', requestable: false }
  }
  if (context.requestedNow) return { standing: 'requested', requestable: false }
  if (season.holding === 'missing') {
    return season.seerrStatus === 'available'
      ? { standing: 'seerr', requestable: false }
      : { standing: 'missing', requestable: true }
  }
  return { standing: 'partial', requestable: season.seerrStatus !== 'available' }
}

export interface SeriesGapSeason extends Omit<StoredSeason, 'seerrStatus' | 'holding'> {
  standing: SeasonStanding
  requestable: boolean
}

export interface SeriesGapShow {
  tmdbId: number
  title: string
  posterPath: string | null
  networks: string[]
  /** The library row holding this show now, resolved on read. */
  libraryId: string | null
  numberingDiffers: boolean
  seasons: SeriesGapSeason[]
  /** Aired regular seasons. */
  total: number
  owned: number
  missing: number
  partial: number
  /** In Seerr, or requested since the scan. */
  pending: number
}

export function decideSeriesGapShow(
  row: Pick<SeriesGapShow, 'tmdbId' | 'title' | 'posterPath' | 'networks' | 'libraryId' | 'numberingDiffers'> & {
    seasons: readonly StoredSeason[]
  },
  active: readonly ActiveSeriesRequest[]
): SeriesGapShow {
  const seasons: SeriesGapSeason[] = row.seasons.map(({ holding, seerrStatus, ...facts }) => ({
    ...facts,
    ...decideSeasonStanding(
      { holding, seerrStatus },
      {
        numberingDiffers: row.numberingDiffers,
        requestedNow: seasonIsRequested(facts.seasonNumber, active),
      }
    ),
  }))
  const count = (standing: SeasonStanding) => seasons.filter((s) => s.standing === standing).length
  return {
    tmdbId: row.tmdbId,
    title: row.title,
    posterPath: row.posterPath,
    networks: row.networks,
    libraryId: row.libraryId,
    numberingDiffers: row.numberingDiffers,
    seasons,
    total: seasons.length,
    owned: count('owned'),
    missing: count('missing'),
    partial: count('partial'),
    pending: count('seerr') + count('requested'),
  }
}
