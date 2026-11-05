/**
 * Which library row a media-server history item means, loaded once per
 * all-user watch-history job instead of once per user.
 *
 * The catalog holds no user state (history and excluded libraries stay
 * per-user), so one copy serves every user in a job. It lives only as long as
 * that job, which makes it stale in two ways, and each has its own answer:
 *
 * - **A title imported, or re-identified, during the run.** The media server
 *   lists an id the catalog does not hold. `refreshMissing` looks up exactly
 *   those ids before the user's history is mapped, so it resolves as a fresh
 *   read would have. There is deliberately no "already asked, not there" memory:
 *   a row that appears after one user's lookup must still resolve for the next.
 *
 * - **A history row for a title the catalog never saw.** It proves nothing about
 *   the media server, so `historyIdsToRemove` leaves it alone and the next job,
 *   whose catalog holds it, decides.
 *
 * A row DELETED during the run is the third case, answered in the upserts: both
 * insert only ids that still exist, or one stale id would fail the user's whole
 * write on its foreign key.
 *
 * Matching is the same order the per-user read used: provider id, then TMDb,
 * IMDb and (shows) TVDb; an episode falls back to series + season + episode.
 */

import { query, type QueryResult } from '../lib/db.js'
import type { WatchedEpisode, WatchedItem } from '../media/types.js'

/** `lib/db.js` `query`, replaceable in tests. */
export type CatalogQuery = <T>(text: string, params?: unknown[]) => Promise<QueryResult<T>>

export interface MovieIdentity {
  id: string
  provider_item_id: string
  provider_library_id: string | null
  tmdb_id: string | null
  imdb_id: string | null
  runtime_minutes: number | null
}

export interface SeriesIdentity {
  id: string
  provider_item_id: string
  tmdb_id: string | null
  imdb_id: string | null
  tvdb_id: string | null
}

export interface EpisodeIdentity {
  id: string
  provider_item_id: string
  series_id: string
  season_number: number
  episode_number: number
  /** The series' library: an episode has none of its own. */
  provider_library_id: string | null
  runtime_minutes: number | null
}

const TICKS_PER_MINUTE = 600000000

/** Falsy on purpose, as it always was: a stored runtime of 0 is no runtime. */
export function runtimeTicksOf(identity: { runtime_minutes: number | null }): number | null {
  return identity.runtime_minutes ? identity.runtime_minutes * TICKS_PER_MINUTE : null
}

/**
 * What a full sync may delete: history the media server did not list, for titles
 * this catalog knows. See the module note for the second half.
 */
export function historyIdsToRemove(
  existingIds: Iterable<string>,
  syncedIds: ReadonlySet<string>,
  catalog: { has(id: string): boolean }
): string[] {
  return [...existingIds].filter((id) => !syncedIds.has(id) && catalog.has(id))
}

function definedStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => !!value)
}

/** Movie lookups. No database: `load…` and `refreshMissing` feed it rows. */
export class MovieCatalogIndex {
  private readonly rows = new Map<string, MovieIdentity>()
  private readonly byProviderId = new Map<string, string>()
  private readonly byTmdbId = new Map<string, string>()
  private readonly byImdbId = new Map<string, string>()

  add(rows: readonly MovieIdentity[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row)
      this.byProviderId.set(row.provider_item_id, row.id)
      if (row.tmdb_id) this.byTmdbId.set(row.tmdb_id, row.id)
      if (row.imdb_id) this.byImdbId.set(row.imdb_id, row.id)
    }
  }

  get size(): number {
    return this.rows.size
  }

  has(id: string): boolean {
    return this.rows.has(id)
  }

  identity(id: string): MovieIdentity | undefined {
    return this.rows.get(id)
  }

  resolve(item: WatchedItem): string | undefined {
    return (
      this.byProviderId.get(item.movieId) ??
      (item.tmdbId ? this.byTmdbId.get(item.tmdbId) : undefined) ??
      (item.imdbId ? this.byImdbId.get(item.imdbId) : undefined)
    )
  }

  isProviderMatch(item: WatchedItem): boolean {
    return this.byProviderId.has(item.movieId)
  }
}

/** Series and episode lookups. No database, as above. */
export class SeriesCatalogIndex {
  private readonly episodes = new Map<string, EpisodeIdentity>()
  private readonly byProviderSeriesId = new Map<string, string>()
  private readonly byTmdbId = new Map<string, string>()
  private readonly byImdbId = new Map<string, string>()
  private readonly byTvdbId = new Map<string, string>()
  private readonly byProviderEpisodeId = new Map<string, string>()
  private readonly byEpisodeKey = new Map<string, string>()

  addSeries(rows: readonly SeriesIdentity[]): void {
    for (const row of rows) {
      this.byProviderSeriesId.set(row.provider_item_id, row.id)
      if (row.tmdb_id) this.byTmdbId.set(row.tmdb_id, row.id)
      if (row.imdb_id) this.byImdbId.set(row.imdb_id, row.id)
      if (row.tvdb_id) this.byTvdbId.set(row.tvdb_id, row.id)
    }
  }

  addEpisodes(rows: readonly EpisodeIdentity[]): void {
    for (const row of rows) {
      this.episodes.set(row.id, row)
      this.byProviderEpisodeId.set(row.provider_item_id, row.id)
      this.byEpisodeKey.set(`${row.series_id}:${row.season_number}:${row.episode_number}`, row.id)
    }
  }

  get size(): number {
    return this.episodes.size
  }

  has(id: string): boolean {
    return this.episodes.has(id)
  }

  identity(id: string): EpisodeIdentity | undefined {
    return this.episodes.get(id)
  }

  resolveSeries(item: WatchedEpisode): string | undefined {
    return (
      this.byProviderSeriesId.get(item.seriesId) ??
      (item.tmdbId ? this.byTmdbId.get(item.tmdbId) : undefined) ??
      (item.imdbId ? this.byImdbId.get(item.imdbId) : undefined) ??
      (item.tvdbId ? this.byTvdbId.get(item.tvdbId) : undefined)
    )
  }

  resolve(item: WatchedEpisode): string | undefined {
    const direct = this.byProviderEpisodeId.get(item.episodeId)
    if (direct) return direct
    const seriesId = this.resolveSeries(item)
    return seriesId && item.seasonNumber != null && item.episodeNumber != null
      ? this.byEpisodeKey.get(`${seriesId}:${item.seasonNumber}:${item.episodeNumber}`)
      : undefined
  }

  isProviderMatch(item: WatchedEpisode): boolean {
    return this.byProviderEpisodeId.has(item.episodeId)
  }
}

export type MovieWatchHistoryCatalog = MovieCatalogIndex & {
  /** Reads the rows behind any item whose provider id the catalog does not hold. */
  refreshMissing(items: readonly WatchedItem[]): Promise<void>
}

export type SeriesWatchHistoryCatalog = SeriesCatalogIndex & {
  /** Reads the rows behind any item whose provider id the catalog does not hold. */
  refreshMissing(items: readonly WatchedEpisode[]): Promise<void>
}

const MOVIE_COLUMNS = 'id, provider_item_id, provider_library_id, tmdb_id, imdb_id, runtime_minutes'
const SERIES_COLUMNS = 'id, provider_item_id, tmdb_id, imdb_id, tvdb_id'
const EPISODE_SELECT = `SELECT e.id, e.provider_item_id, e.series_id, e.season_number, e.episode_number, e.runtime_minutes, s.provider_library_id
       FROM episodes e
       JOIN series s ON e.series_id = s.id
       WHERE e.provider_item_id IS NOT NULL`

export async function loadMovieWatchHistoryCatalog(
  run: CatalogQuery = query
): Promise<MovieWatchHistoryCatalog> {
  const index = new MovieCatalogIndex()
  const movies = await run<MovieIdentity>(
    `SELECT ${MOVIE_COLUMNS} FROM movies WHERE provider_item_id IS NOT NULL`
  )
  index.add(movies.rows)

  return Object.assign(index, {
    async refreshMissing(items: readonly WatchedItem[]): Promise<void> {
      // By provider id, not "unresolved": an item a fallback id resolves can
      // still be a copy imported mid-run, and a fresh read would have matched it.
      const missing = items.filter((item) => !index.isProviderMatch(item))
      if (missing.length === 0) return
      const found = await run<MovieIdentity>(
        `SELECT ${MOVIE_COLUMNS} FROM movies
         WHERE provider_item_id IS NOT NULL
           AND (provider_item_id = ANY($1::text[]) OR tmdb_id = ANY($2::text[]) OR imdb_id = ANY($3::text[]))`,
        [
          missing.map((item) => item.movieId),
          definedStrings(missing.map((item) => item.tmdbId)),
          definedStrings(missing.map((item) => item.imdbId)),
        ]
      )
      index.add(found.rows)
    },
  })
}

export async function loadSeriesWatchHistoryCatalog(
  run: CatalogQuery = query
): Promise<SeriesWatchHistoryCatalog> {
  const index = new SeriesCatalogIndex()
  const [series, episodes] = await Promise.all([
    run<SeriesIdentity>(`SELECT ${SERIES_COLUMNS} FROM series WHERE provider_item_id IS NOT NULL`),
    run<EpisodeIdentity>(EPISODE_SELECT),
  ])
  index.addSeries(series.rows)
  index.addEpisodes(episodes.rows)

  return Object.assign(index, {
    async refreshMissing(items: readonly WatchedEpisode[]): Promise<void> {
      const missing = items.filter((item) => !index.isProviderMatch(item))
      if (missing.length === 0) return

      const foundSeries = await run<SeriesIdentity>(
        `SELECT ${SERIES_COLUMNS} FROM series
         WHERE provider_item_id IS NOT NULL
           AND (provider_item_id = ANY($1::text[]) OR tmdb_id = ANY($2::text[])
             OR imdb_id = ANY($3::text[]) OR tvdb_id = ANY($4::text[]))`,
        [
          missing.map((item) => item.seriesId),
          definedStrings(missing.map((item) => item.tmdbId)),
          definedStrings(missing.map((item) => item.imdbId)),
          definedStrings(missing.map((item) => item.tvdbId)),
        ]
      )
      index.addSeries(foundSeries.rows)

      // After the series: the coordinates need the series a new item belongs to.
      const coordinates = missing.flatMap((item) => {
        const seriesId = index.resolveSeries(item)
        return seriesId && item.seasonNumber != null && item.episodeNumber != null
          ? [{ seriesId, season: item.seasonNumber, episode: item.episodeNumber }]
          : []
      })
      const foundEpisodes = await run<EpisodeIdentity>(
        `${EPISODE_SELECT}
         AND (e.provider_item_id = ANY($1::text[])
           OR (e.series_id, e.season_number, e.episode_number) IN (
             SELECT * FROM unnest($2::uuid[], $3::int[], $4::int[])
           ))`,
        [
          missing.map((item) => item.episodeId),
          coordinates.map((c) => c.seriesId),
          coordinates.map((c) => c.season),
          coordinates.map((c) => c.episode),
        ]
      )
      index.addEpisodes(foundEpisodes.rows)
    },
  })
}
