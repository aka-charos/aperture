/**
 * The watch-stats responses are a fixed list of fields, and nothing in them can
 * give away how many accounts exist: the count is printed on the page, so a total
 * or a share beside it is the number of users (F-186). In `test:security` so CI
 * runs it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { watchStatsSchema as movieSchema } from './movies/schemas.js'
import { watchStatsSchema as seriesSchema } from './series/schemas.js'

const ROUTES = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(ROUTES, '..', '..', '..', '..')

async function send(schema: typeof movieSchema | typeof seriesSchema, payload: object) {
  const app = Fastify()
  app.get('/stats', { schema: { response: schema.response } }, async () => payload)
  const response = await app.inject({ url: '/stats' })
  await app.close()
  assert.equal(response.statusCode, 200)
  return response.json() as Record<string, unknown>
}

const LEAKS = { totalUsers: 99, watchPercentage: 12, accounts: 99, userCount: 99 }

const WATCHER = {
  userId: 'u1',
  name: 'Someone',
  playCount: 2,
  lastWatched: '2026-01-01T00:00:00.000Z',
  favorite: true,
}

test('a movie response drops any field it does not list', async () => {
  const sent = await send(movieSchema, {
    totalWatchers: 3,
    totalPlays: 4,
    favoritesCount: 1,
    firstWatched: new Date('2026-01-01T00:00:00.000Z'),
    lastWatched: null,
    averageUserRating: null,
    totalRatings: 0,
    householdReach: 'popular',
    watchers: [{ ...WATCHER, ...LEAKS }],
    watcherAudience: 'all',
    ...LEAKS,
  })

  for (const key of Object.keys(LEAKS)) assert.equal(key in sent, false, key)
  assert.deepEqual(sent.watchers, [WATCHER])
  assert.equal(sent.totalWatchers, 3)
  assert.equal(sent.householdReach, 'popular')
  assert.equal(sent.watcherAudience, 'all')
  assert.equal(sent.firstWatched, '2026-01-01T00:00:00.000Z')
  assert.equal(sent.averageUserRating, null)
})

test('a series response drops any field it does not list', async () => {
  const sent = await send(seriesSchema, {
    currentlyWatching: 1,
    totalViewers: 3,
    completedViewers: 1,
    totalEpisodes: 24,
    totalEpisodePlays: 40,
    favoritedEpisodes: 2,
    // What the handler builds when no played row has a date: must not throw.
    firstWatched: new Date(Number.POSITIVE_INFINITY),
    lastWatched: null,
    averageUserRating: 8,
    totalRatings: 1,
    averageProgress: 55,
    householdReach: 'niche',
    watchers: [{ ...WATCHER, episodesWatched: 5 }],
    ...LEAKS,
  })

  for (const key of Object.keys(LEAKS)) assert.equal(key in sent, false, key)
  assert.deepEqual(sent.watchers, [{ ...WATCHER, episodesWatched: 5 }])
  assert.equal(sent.firstWatched, null)
  assert.equal(sent.averageProgress, 55)
  assert.equal(sent.householdReach, 'niche')
  assert.equal('watcherAudience' in sent, false)
})

test('an optional field stays absent, not null', async () => {
  const sent = await send(movieSchema, { totalWatchers: 0, totalPlays: 0 })
  assert.equal('householdReach' in sent, false)
  assert.equal('watchers' in sent, false)
})

test('nothing behind the routes reads the accounts table for a total', () => {
  const files = [
    join(ROUTES, 'movies', 'handlers', 'watchStats.ts'),
    join(ROUTES, 'series', 'handlers', 'watchStats.ts'),
    join(REPO_ROOT, 'packages', 'core', 'src', 'watching', 'householdReach.ts'),
    join(REPO_ROOT, 'packages', 'core', 'src', 'watching', 'householdReachStore.ts'),
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /\b(?:FROM|JOIN)\s+(?:public\.)?"?users\b/i, file)
    assert.doesNotMatch(source, /totalUsers|watchPercentage/, file)
  }
})
