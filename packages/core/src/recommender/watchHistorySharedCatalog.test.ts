import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { EmbyProvider } = await import('../media/emby/EmbyProvider.js')
const { syncWatchHistoryForAllUsers, syncWatchHistoryForUser } = await import('./movies/sync.js')
const { syncSeriesWatchHistoryForAllUsers, syncSeriesWatchHistoryForUser } = await import(
  './series/watchHistorySync.js'
)

/**
 * A whole all-user job against a recording database: one catalog read per job, a
 * targeted read for what arrived during it, and per-user state kept per user.
 */
test('a job shares one catalog while user state stays per user', async (t) => {
  // completeJob keeps its record for minutes on a timer, which would hold the
  // test process open.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const users = [
    { id: 'user-a', provider_user_id: 'provider-a', username: 'A' },
    { id: 'user-b', provider_user_id: 'provider-b', username: 'B' },
  ]
  let media: 'movie' | 'series' = 'movie'
  let imported = false
  let fullLoads = 0
  let targetedLoads = 0
  const writes = new Map<string, unknown[]>()
  const removals = new Map<string, string[]>()

  const identity = (suffix: string, library: string) => ({
    id: suffix,
    provider_item_id: `provider-${suffix}`,
    provider_library_id: library,
    tmdb_id: suffix,
    imdb_id: `imdb-${suffix}`,
    tvdb_id: `tvdb-${suffix}`,
    runtime_minutes: 45,
    series_id: 'show',
    season_number: 1,
    episode_number: suffix === 'a' ? 1 : suffix === 'b' ? 2 : 3,
  })
  const watch = (suffix: string) => ({
    movieId: `provider-${suffix}`,
    episodeId: `provider-${suffix}`,
    seriesId: 'provider-show',
    seasonNumber: 1,
    episodeNumber: suffix === 'a' ? 1 : suffix === 'b' ? 2 : 3,
    playCount: 1,
    isFavorite: false,
    played: true,
  })
  // user-a: excludes library `kids` (title a), lists b twice under two ids.
  // user-b: excludes nothing, lists a and the title imported during the run.
  const history = (providerUserId: string) =>
    providerUserId === 'provider-a'
      ? [
          watch('a'),
          { ...watch('b'), isFavorite: true },
          {
            ...watch('b'),
            movieId: 'alias-b',
            episodeId: 'alias-b',
            tmdbId: media === 'movie' ? 'b' : 'show',
            seriesId: 'old-show-id',
            playCount: 3,
          },
        ]
      : [{ ...watch('a'), playCount: 7 }, watch('c')]

  t.mock.method(EmbyProvider.prototype, 'getUsers', async () =>
    users.map((user) => ({ id: user.provider_user_id, name: user.username }))
  )
  t.mock.method(EmbyProvider.prototype, 'getWatchHistory', async (_key: string, id: string) =>
    history(id)
  )
  t.mock.method(EmbyProvider.prototype, 'getSeriesWatchHistory', async (_key: string, id: string) =>
    history(id)
  )

  const queryMock = t.mock.method(getPool(), 'query', async (sql: string, params: unknown[] = []) => {
    let rows: unknown[] = []
    if (sql.includes('FROM system_settings')) {
      const settings: Record<string, string> = {
        media_server_type: 'emby',
        media_server_base_url: 'http://localhost:8096',
        media_server_api_key: 'test',
      }
      rows = [{ value: settings[params[0] as string] }]
    } else if (sql.includes('FROM users WHERE provider_user_id IS NOT NULL')) {
      rows = users
    } else if (sql.includes('watch_history_synced_at FROM users')) {
      rows = [{ watch_history_synced_at: null, series_watch_history_synced_at: null }]
    } else if (sql.includes('SELECT settings FROM user_preferences')) {
      rows = [{ settings: { excludedLibraryIds: params[0] === 'user-a' ? ['kids'] : [] } }]
    } else if (sql.includes('INSERT INTO watch_history')) {
      writes.set(params[0] as string, params)
      return { rows: [], rowCount: (params[1] as string[]).length }
    } else if (sql.includes('DELETE FROM watch_history')) {
      removals.set(params[0] as string, params[1] as string[])
      return { rows: [], rowCount: (params[1] as string[]).length }
    } else if (/FROM watch_history\s+WHERE user_id/.test(sql) && sql.startsWith('SELECT')) {
      const field = media === 'movie' ? 'movie_id' : 'episode_id'
      // `imported-during-job` is a history row for a title no catalog has seen.
      rows = ['a', 'b', ...(params[0] === 'user-a' ? ['imported-during-job'] : [])].map((id) => ({
        [field]: id,
      }))
    } else if (/FROM movies\s+WHERE provider_item_id IS NOT NULL/.test(sql)) {
      if (sql.includes('ANY')) {
        targetedLoads++
        imported = true
        rows = [identity('c', 'main')]
      } else {
        fullLoads++
        rows = [identity('a', 'kids'), identity('b', 'main'), ...(imported ? [identity('c', 'main')] : [])]
      }
    } else if (/FROM series\s+WHERE provider_item_id IS NOT NULL/.test(sql)) {
      rows = [identity('show', 'main')]
    } else if (/FROM episodes e\s+JOIN series s/.test(sql)) {
      if (sql.includes('ANY')) {
        targetedLoads++
        imported = true
        rows = [identity('c', 'main')]
      } else {
        fullLoads++
        rows = [identity('a', 'kids'), identity('b', 'main'), ...(imported ? [identity('c', 'main')] : [])]
      }
    } else if (
      sql.includes('UPDATE users SET') ||
      sql.includes('UPDATE watch_history') ||
      sql.includes('job_runs')
    ) {
      rows = []
    } else {
      throw new Error(`Unexpected query: ${sql}`)
    }
    return { rows, rowCount: rows.length }
  })

  try {
    for (const kind of ['movie', 'series'] as const) {
      media = kind
      imported = false
      fullLoads = 0
      targetedLoads = 0
      writes.clear()
      removals.clear()
      const allUsers = kind === 'movie' ? syncWatchHistoryForAllUsers : syncSeriesWatchHistoryForAllUsers
      const oneUser = kind === 'movie' ? syncWatchHistoryForUser : syncSeriesWatchHistoryForUser

      const result = await allUsers(undefined, true)
      assert.equal(result.success, 2)
      assert.equal(result.failed, 0)
      assert.equal(fullLoads, 1, 'one catalog for the whole job')
      // user-a's alias asks too: a fallback id does not prove the provider id is known.
      assert.ok(targetedLoads >= 1, 'the title imported mid-run is looked up')
      assert.ok(targetedLoads <= 2, 'one lookup per user at most')

      // user-a excludes library `kids`: title a is dropped, the two b rows merge.
      assert.deepEqual(writes.get('user-a')?.[1], ['b'])
      assert.deepEqual(writes.get('user-a')?.[2], [3])
      assert.deepEqual(writes.get('user-a')?.[4], [true])
      assert.deepEqual(writes.get('user-a')?.[7], [45 * 600000000])
      // user-b excludes nothing, and reaches the imported title.
      assert.deepEqual(writes.get('user-b')?.[1], ['a', 'c'])
      assert.deepEqual(writes.get('user-b')?.[2], [7, 1])

      // Unlisted history goes; the row for a title outside the catalog stays.
      assert.deepEqual(removals.get('user-a'), ['a'])
      assert.deepEqual(removals.get('user-b'), ['b'])

      await allUsers(undefined, false)
      assert.equal(fullLoads, 2, 'each job reads a fresh catalog')
      await oneUser('user-a', 'provider-a', false)
      assert.equal(fullLoads, 3, 'a single-user sync reads its own')
    }
  } finally {
    t.mock.timers.tick(10 * 60 * 1000 + 1)
    queryMock.mock.restore()
    await closePool()
  }
})

test('both upserts insert only ids that still exist', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = fileURLToPath(new URL('.', import.meta.url))
  const movies = readFileSync(join(here, 'movies', 'sync.ts'), 'utf8')
  const series = readFileSync(join(here, 'series', 'watchHistorySync.ts'), 'utf8')
  assert.match(movies, /WHERE EXISTS \(SELECT 1 FROM movies m WHERE m\.id = t\.movie_id\)/)
  assert.match(series, /WHERE EXISTS \(SELECT 1 FROM episodes e WHERE e\.id = t\.episode_id\)/)
})
