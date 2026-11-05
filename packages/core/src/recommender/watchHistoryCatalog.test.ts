import test from 'node:test'
import assert from 'node:assert/strict'
import type { QueryResult } from '../lib/db.js'
import type { WatchedEpisode, WatchedItem } from '../media/types.js'
import {
  historyIdsToRemove,
  loadMovieWatchHistoryCatalog,
  loadSeriesWatchHistoryCatalog,
  runtimeTicksOf,
  type CatalogQuery,
  type EpisodeIdentity,
  type MovieIdentity,
  type SeriesIdentity,
} from './watchHistoryCatalog.js'

const movie = (id: string, extra: Partial<MovieIdentity> = {}): MovieIdentity => ({
  id,
  provider_item_id: `p-${id}`,
  provider_library_id: 'main',
  tmdb_id: `t-${id}`,
  imdb_id: `i-${id}`,
  runtime_minutes: 100,
  ...extra,
})
const show = (id: string, extra: Partial<SeriesIdentity> = {}): SeriesIdentity => ({
  id,
  provider_item_id: `p-${id}`,
  tmdb_id: `t-${id}`,
  imdb_id: `i-${id}`,
  tvdb_id: `v-${id}`,
  ...extra,
})
const episode = (id: string, seriesId: string, n: number): EpisodeIdentity => ({
  id,
  provider_item_id: `p-${id}`,
  series_id: seriesId,
  season_number: 1,
  episode_number: n,
  provider_library_id: 'tv',
  runtime_minutes: 45,
})
const watched = (movieId: string, extra: Partial<WatchedItem> = {}): WatchedItem => ({
  movieId,
  playCount: 1,
  isFavorite: false,
  ...extra,
})
const watchedEpisode = (episodeId: string, extra: Partial<WatchedEpisode> = {}): WatchedEpisode => ({
  episodeId,
  seriesId: 'p-none',
  playCount: 1,
  isFavorite: false,
  ...extra,
})

/** A database that answers by the table a statement reads, and records each. */
function fakeDb(tables: { movies?: MovieIdentity[]; series?: SeriesIdentity[]; episodes?: EpisodeIdentity[] }) {
  const calls: Array<{ text: string; params?: unknown[] }> = []
  const run: CatalogQuery = async <T,>(text: string, params?: unknown[]): Promise<QueryResult<T>> => {
    calls.push({ text, params })
    const lists = params as string[][] | undefined
    const has = (list: unknown, value: unknown) => Array.isArray(list) && list.includes(value)
    let rows: unknown[]
    if (/FROM episodes/.test(text)) {
      rows = (tables.episodes ?? []).filter(
        (row) =>
          !lists ||
          has(lists[0], row.provider_item_id) ||
          (lists[1] as string[]).some(
            (seriesId, i) =>
              seriesId === row.series_id &&
              (lists[2] as unknown as number[])[i] === row.season_number &&
              (lists[3] as unknown as number[])[i] === row.episode_number
          )
      )
    } else if (/FROM series/.test(text)) {
      rows = (tables.series ?? []).filter(
        (row) =>
          !lists ||
          has(lists[0], row.provider_item_id) ||
          has(lists[1], row.tmdb_id) ||
          has(lists[2], row.imdb_id) ||
          has(lists[3], row.tvdb_id)
      )
    } else {
      rows = (tables.movies ?? []).filter(
        (row) =>
          !lists ||
          has(lists[0], row.provider_item_id) ||
          has(lists[1], row.tmdb_id) ||
          has(lists[2], row.imdb_id)
      )
    }
    return { rows: rows as T[], rowCount: rows.length }
  }
  return { run, calls }
}

test('a movie resolves by provider id, then TMDb, then IMDb, as the per-user read did', async () => {
  const catalog = await loadMovieWatchHistoryCatalog(fakeDb({ movies: [movie('a'), movie('b')] }).run)

  assert.equal(catalog.resolve(watched('p-a')), 'a')
  assert.equal(catalog.resolve(watched('p-a', { tmdbId: 't-b', imdbId: 'i-b' })), 'a')
  assert.equal(catalog.resolve(watched('alias', { tmdbId: 't-b', imdbId: 'i-a' })), 'b')
  assert.equal(catalog.resolve(watched('alias', { tmdbId: 'none', imdbId: 'i-a' })), 'a')
  assert.equal(catalog.resolve(watched('alias')), undefined)

  assert.equal(catalog.isProviderMatch(watched('p-a')), true)
  assert.equal(catalog.isProviderMatch(watched('alias', { tmdbId: 't-b' })), false)
})

test('an episode resolves by provider id, else by its series and coordinates', async () => {
  const catalog = await loadSeriesWatchHistoryCatalog(
    fakeDb({ series: [show('s')], episodes: [episode('e1', 's', 1), episode('e2', 's', 2)] }).run
  )
  const at = { seasonNumber: 1, episodeNumber: 2 }

  assert.equal(catalog.resolve(watchedEpisode('p-e1')), 'e1')
  assert.equal(catalog.resolve(watchedEpisode('alias', { seriesId: 'p-s', ...at })), 'e2')
  assert.equal(catalog.resolve(watchedEpisode('alias', { tmdbId: 't-s', ...at })), 'e2')
  assert.equal(catalog.resolve(watchedEpisode('alias', { imdbId: 'i-s', ...at })), 'e2')
  assert.equal(catalog.resolve(watchedEpisode('alias', { tvdbId: 'v-s', ...at })), 'e2')
  assert.equal(catalog.resolve(watchedEpisode('alias', { seriesId: 'p-s' })), undefined)
  assert.equal(catalog.identity('e2')?.provider_library_id, 'tv')
})

test('a title imported after the load is found by a targeted read, not a reload', async () => {
  const live: MovieIdentity[] = [movie('a')]
  const db = fakeDb({ movies: live })
  const catalog = await loadMovieWatchHistoryCatalog(db.run)
  assert.equal(db.calls.length, 1)

  // Nothing unknown: no read at all.
  await catalog.refreshMissing([watched('p-a')])
  assert.equal(db.calls.length, 1)

  // The import happens after the load; only the unknown id is asked about.
  live.push(movie('late'))
  db.calls.length = 0
  await catalog.refreshMissing([watched('p-a'), watched('p-late', { tmdbId: 't-late' })])

  assert.equal(db.calls.length, 1)
  assert.match(db.calls[0].text, /provider_item_id = ANY/)
  assert.deepEqual(db.calls[0].params?.[0], ['p-late'])
  assert.equal(catalog.resolve(watched('p-late')), 'late')
  assert.equal(catalog.has('late'), true)
})

test('a miss is asked again for the next user: there is no negative memory', async () => {
  const live: MovieIdentity[] = []
  const db = fakeDb({ movies: live })
  const catalog = await loadMovieWatchHistoryCatalog(db.run)
  db.calls.length = 0

  await catalog.refreshMissing([watched('p-late')])
  assert.equal(catalog.resolve(watched('p-late')), undefined)

  live.push(movie('late'))
  await catalog.refreshMissing([watched('p-late')])
  assert.equal(db.calls.length, 2)
  assert.equal(catalog.resolve(watched('p-late')), 'late')
})

test('a copy imported mid-run wins over the fallback id, as a fresh read would', async () => {
  const live: MovieIdentity[] = [movie('a', { tmdb_id: 'shared' })]
  const db = fakeDb({ movies: live })
  const catalog = await loadMovieWatchHistoryCatalog(db.run)

  const item = watched('p-copy', { tmdbId: 'shared' })
  assert.equal(catalog.resolve(item), 'a')

  live.push(movie('copy', { tmdb_id: 'shared' }))
  await catalog.refreshMissing([item])
  assert.equal(catalog.resolve(item), 'copy')
})

test('a show and its episode both imported mid-run are found together', async () => {
  const series: SeriesIdentity[] = []
  const episodes: EpisodeIdentity[] = []
  const db = fakeDb({ series, episodes })
  const catalog = await loadSeriesWatchHistoryCatalog(db.run)
  db.calls.length = 0

  series.push(show('s'))
  episodes.push(episode('e1', 's', 1))
  // Provider id of the episode differs: only the coordinates can reach it, and
  // they are only known once the series has been read.
  const item = watchedEpisode('alias', { seriesId: 'p-s', seasonNumber: 1, episodeNumber: 1 })
  await catalog.refreshMissing([item])

  assert.equal(db.calls.length, 2)
  assert.deepEqual(db.calls[1].params?.[1], ['s'])
  assert.equal(catalog.resolve(item), 'e1')
})

test('full-sync removal leaves history the catalog cannot speak for', () => {
  const catalog = new Set(['listed', 'gone'])
  assert.deepEqual(
    historyIdsToRemove(['listed', 'gone', 'imported-during-the-run'], new Set(['listed']), catalog),
    ['gone']
  )
  assert.deepEqual(historyIdsToRemove([], new Set(), catalog), [])
})

test('a stored runtime of 0 or NULL is no runtime; minutes become ticks', () => {
  assert.equal(runtimeTicksOf({ runtime_minutes: 45 }), 45 * 600000000)
  assert.equal(runtimeTicksOf({ runtime_minutes: 0 }), null)
  assert.equal(runtimeTicksOf({ runtime_minutes: null }), null)
})
