import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AiredEpisode, EpisodeStanding, UpcomingEpisode, UpcomingGap } from '@aperture/core/watching'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../../../lib/db.js')
const { createUpcomingTools } = await import('./upcoming.js')
const { withUnwatchedFilter } = await import('../helpers/unwatched.js')
const { withStatusEvents } = await import('../helpers/status.js')
const { filterItemsToScope, withLibraryScope } = await import('../helpers/libraryScope.js')
const { withToolErrorHandling } = await import('./utils.js')
const {
  buildUpcomingAnswer,
  describeLatestAired,
  describeNext,
  upcomingAnswerKind,
  UPCOMING_MAX_LISTED_TITLES,
  UPCOMING_MAX_NAME_MATCHES,
} = await import('./upcomingAnswer.js')
type FollowedShow = import('./upcomingAnswer.js').FollowedShow

const TODAY = '2026-11-06'

function show(id: string, overrides: Partial<FollowedShow> = {}): FollowedShow {
  return {
    id,
    title: id,
    year: 2020,
    poster_url: null,
    genres: ['Drama', 'Crime', 'Mystery'],
    community_rating: '7.50',
    tmdb_status: 'Returning Series',
    ...overrides,
  }
}

function episode(seriesId: string, airDate: string, source: 'emby' | 'tmdb' = 'tmdb'): UpcomingEpisode {
  return {
    seriesId,
    seasonNumber: 2,
    episodeNumber: 5,
    title: 'Next one',
    overview: 'What happens in it.',
    airDate,
    source,
  }
}

function answer(input: {
  shows: FollowedShow[]
  episodes?: UpcomingEpisode[]
  gaps?: Record<string, UpcomingGap>
  latest?: Record<string, AiredEpisode>
  standings?: Record<string, EpisodeStanding>
  limit?: number
  series?: string
}) {
  return buildUpcomingAnswer({
    id: 'upcoming-1',
    shows: input.shows,
    report: {
      episodes: new Map((input.episodes ?? []).map((e) => [e.seriesId, e])),
      gaps: new Map(Object.entries(input.gaps ?? {})),
    },
    latestAired: new Map(Object.entries(input.latest ?? {})),
    standings: new Map(Object.entries(input.standings ?? {})),
    today: TODAY,
    limit: input.limit ?? 20,
    series: input.series,
  })
}

// ============================================================================
// Separate answers stay separate
// ============================================================================

test('empty, no key and a failed lookup are different answers', () => {
  assert.equal(answer({ shows: [] }).answer, 'notFollowing')

  const none = answer({ shows: [show('a')], gaps: { a: 'noneAnnounced' } })
  assert.equal(none.answer, 'nothingAnnounced')
  assert.equal(none.descriptionKey, 'carouselUpcomingNothing')

  const noKey = answer({ shows: [show('a')], gaps: { a: 'noTmdbKey' } })
  assert.equal(noKey.answer, 'noTmdbKey')
  assert.equal(noKey.descriptionKey, 'carouselUpcomingNoTmdbKey')

  const failed = answer({ shows: [show('a')], gaps: { a: 'lookupFailed' } })
  assert.equal(failed.answer, 'lookupFailed')
  assert.equal(failed.descriptionKey, 'carouselUpcomingLookupFailed')

  const unknown = answer({ shows: [show('a')], gaps: { a: 'noTmdbEntry' } })
  assert.equal(unknown.answer, 'noTmdbEntry')
  assert.equal(unknown.descriptionKey, 'carouselUpcomingNoTmdbEntry')
})

test('a named show outside the library says so, under its own heading', () => {
  const missing = answer({ shows: [], series: 'Severance' })
  assert.equal(missing.answer, 'notInLibrary')
  assert.equal(missing.descriptionKey, 'carouselUpcomingNotInLibrary')
  assert.deepEqual(missing.descriptionParams, { series: 'Severance' })
  assert.equal(missing.titleKey, 'carouselUpcomingSeriesTitle')
  assert.deepEqual(missing.titleParams, { series: 'Severance' })
  // Not followed is a different answer, for a different question.
  assert.equal(answer({ shows: [] }).titleKey, 'carouselUpcomingTitle')
  assert.equal(answer({ shows: [] }).titleParams, undefined)
})

test('a failed lookup is never read as nothing being announced', () => {
  // One show TMDb answered for and one it did not: the honest headline is the
  // failure, since the second show may well have an episode coming.
  const mixed = answer({
    shows: [show('a'), show('b')],
    gaps: { a: 'noneAnnounced', b: 'lookupFailed' },
  })
  assert.equal(mixed.answer, 'lookupFailed')
  assert.deepEqual(mixed.nothingAnnounced.map((s) => s.title), ['a'])
  assert.deepEqual(mixed.couldNotCheck.map((s) => [s.title, s.reason]), [['b', 'lookupFailed']])
})

test('a show with no recorded outcome counts as not checked', () => {
  // Reading absence as "nothing announced" is the merge the report exists to stop.
  assert.equal(answer({ shows: [show('a')] }).answer, 'lookupFailed')
  assert.equal(answer({ shows: [show('a')], gaps: { a: 'notAsked' } }).answer, 'lookupFailed')
})

test('dates beat a partial failure, and the caption owns up to it', () => {
  const partial = answer({
    shows: [show('a'), show('b')],
    episodes: [episode('a', '2026-11-20')],
    gaps: { b: 'lookupFailed' },
  })
  assert.equal(partial.answer, 'scheduled')
  assert.equal(partial.descriptionKey, 'carouselUpcomingDescPartial')
  assert.deepEqual(partial.descriptionParams, { count: 1, unchecked: 1 })
})

test('the verdict order holds whatever else is true', () => {
  const counts = { shows: 2, named: false, scheduled: 0, nothingAnnounced: 1 }
  assert.equal(upcomingAnswerKind({ ...counts, reasons: new Set(['noTmdbKey']) }), 'noTmdbKey')
  assert.equal(upcomingAnswerKind({ ...counts, reasons: new Set(['lookupFailed']) }), 'lookupFailed')
  assert.equal(upcomingAnswerKind({ ...counts, reasons: new Set(['noTmdbEntry']) }), 'nothingAnnounced')
})

// ============================================================================
// Expected versus aired and held
// ============================================================================

test('a forecast and a server listing are both only expected', () => {
  const forecast = describeNext(episode('a', '2026-11-20', 'tmdb'), TODAY)
  assert.equal(forecast.status, 'expected')
  assert.equal(forecast.basis, 'tmdbForecast')

  const listing = describeNext(episode('a', '2026-11-20', 'emby'), TODAY)
  assert.equal(listing.status, 'expected')
  assert.equal(listing.basis, 'serverListing')
})

test('a forecast whose day has passed does not claim the episode arrived', () => {
  assert.equal(describeNext(episode('a', '2026-11-01'), TODAY).status, 'pastDue')
  assert.equal(describeNext(episode('a', TODAY), TODAY).status, 'expected', 'today has not passed')
})

test('the upcoming episode carries no synopsis: it would spoil what has not aired', () => {
  const next = describeNext(episode('a', '2026-11-20'), TODAY)
  assert.equal('overview' in next, false)
  const { items } = answer({ shows: [show('a')], episodes: [episode('a', '2026-11-20')] })
  assert.equal(items[0].overview, undefined)
})

const aired = (source: 'emby' | 'tmdb'): AiredEpisode => ({
  seasonNumber: 2,
  episodeNumber: 4,
  title: 'Aired',
  airDate: '2026-10-30',
  source,
})

test('an aired episode is in the library only when that episode has a file', () => {
  const held = { held: true, played: false }
  const placeholder = { held: false, played: false }
  // Whichever source dated it: a server row can be a placeholder for a missing
  // episode, and a TMDb date can be for one the server holds undated.
  assert.equal(describeLatestAired(aired('emby'), held)?.inLibrary, true)
  assert.equal(describeLatestAired(aired('tmdb'), held)?.inLibrary, true)
  assert.equal(describeLatestAired(aired('emby'), placeholder)?.inLibrary, false)
  assert.equal(describeLatestAired(aired('emby'), undefined)?.inLibrary, false, 'no row')
  assert.equal(describeLatestAired(undefined, held), null)
})

test('played is about that episode, and absent is not played', () => {
  assert.equal(describeLatestAired(aired('emby'), { held: true, played: true })?.played, true)
  assert.equal(describeLatestAired(aired('emby'), { held: true, played: false })?.played, false)
  assert.equal(describeLatestAired(aired('emby'), undefined)?.played, false)
})

// ============================================================================
// Cards and lists
// ============================================================================

test('cards are the shows themselves, soonest first, up to the limit', () => {
  const { items, counts, descriptionParams } = answer({
    shows: [show('later'), show('soon'), show('also soon')],
    episodes: [
      episode('later', '2027-06-01'),
      episode('soon', '2026-11-20'),
      episode('also soon', '2026-11-20'),
    ],
    limit: 2,
  })
  assert.deepEqual(items.map((i) => i.id), ['also soon', 'soon'])
  assert.equal(counts.scheduled, 3, 'the limit cuts cards, not the count')
  assert.equal(descriptionParams.count, 2, 'the caption describes the cards it sits over')
  // The card opens the show. An `episode` ref would make it navigate and offer Play.
  assert.equal(items[0].type, 'series')
  assert.equal(items[0].episode, undefined)
  assert.equal(items[0].actions?.[0].href, '/series/also soon')
  assert.equal(items[0].subtitle, '2020 · Drama, Crime')
  assert.equal(items[0].rating, 7.5)
})

test('a far-off premiere is still the answer here', () => {
  // The Watching page's two-month horizon is a display rule for that page.
  const { items } = answer({ shows: [show('a')], episodes: [episode('a', '2028-01-01')] })
  assert.equal(items.length, 1)
})

test('a NULL rating stays null, and a stored zero stays zero', () => {
  const rated = (community_rating: FollowedShow['community_rating']) =>
    answer({ shows: [show('a', { community_rating })], episodes: [episode('a', '2026-11-20')] })
      .items[0].rating
  assert.equal(rated(null), null)
  assert.equal(rated('0.00'), 0)
})

test('only TMDb saying so marks a show as ended', () => {
  const none = (tmdb_status: string | null) =>
    answer({ shows: [show('a', { tmdb_status })], gaps: { a: 'noneAnnounced' } }).nothingAnnounced[0].ended
  assert.equal(none('Ended'), true)
  assert.equal(none('Canceled'), true)
  assert.equal(none('Returning Series'), false)
  assert.equal(none(null), false)
})

test('the no-date lists are capped, and the counts are not', () => {
  const shows = Array.from({ length: UPCOMING_MAX_LISTED_TITLES + 5 }, (_, i) => show(`s${i}`))
  const gaps = Object.fromEntries(shows.map((s) => [s.id, 'noneAnnounced' as const]))
  const result = answer({ shows, gaps })
  assert.equal(result.nothingAnnounced.length, UPCOMING_MAX_LISTED_TITLES)
  assert.equal(result.counts.nothingAnnounced, shows.length)
  assert.equal(result.descriptionParams.count, shows.length)
})

test('the result renders as a carousel and carries the keys the client dispatches on', () => {
  // Thread.tsx dispatches on shape: `items` is what makes it a ContentCarousel,
  // an empty one included, whose caption is the only thing then shown.
  const empty = answer({ shows: [] })
  assert.deepEqual(empty.items, [])
  assert.equal(empty.titleKey, 'carouselUpcomingTitle')
  assert.equal(empty.descriptionKey, 'carouselUpcomingNotFollowing')
  for (const key of ['carousels', 'contentId', 'people', 'movieCount', 'studios', 'analysis', 'error']) {
    assert.equal(key in empty, false, key)
  }
})

// ============================================================================
// The tool and its wrappers
// ============================================================================

const scope = { libraryIds: ['lib-a'], maxParentalRating: 13, hasMovies: true, hasSeries: true }
const ctx = { userId: 'viewer-1', scope } as unknown as Parameters<typeof createUpcomingTools>[0]

type Execute = (input: { series?: string; limit?: number }, options: unknown) => Promise<Record<string, unknown>>
const execute = (context = ctx) =>
  createUpcomingTools(context).getUpcomingEpisodes.execute as unknown as Execute

const restores: Array<() => void> = []
function mockPool(handler: (sql: string, params: unknown[]) => { rows: unknown[] }) {
  const pool = getPool()
  const original = pool.query
  Object.assign(pool, {
    query: async (sql: string, params: unknown[] = []) => ({ rowCount: 0, ...handler(sql, params) }),
  })
  restores.push(() => Object.assign(pool, { query: original }))
}
afterEach(async () => {
  for (const restore of restores.splice(0)) restore()
  await closePool()
})

test("the list reads this viewer's shows through their library scope", async () => {
  const seen: Array<{ sql: string; params: unknown[] }> = []
  mockPool((sql, params) => {
    seen.push({ sql, params })
    return { rows: [] }
  })
  const result = await execute()({}, {})

  assert.equal(result.answer, 'notFollowing')
  assert.equal(seen.length, 1, 'no shows: no lookups, no TMDb')
  assert.match(seen[0].sql, /FROM user_watching_series uws/)
  assert.match(seen[0].sql, /s\.provider_library_id = ANY/)
  assert.match(seen[0].sql, /parental_rating_values/)
  assert.deepEqual(seen[0].params, ['viewer-1', ['lib-a'], 13])
})

test('a show outside the scope answers exactly like a show not followed', async () => {
  // The database applies the scope, so to this tool the show is simply not in
  // the rows: nothing about it can reach a card or a no-date list.
  mockPool(() => ({ rows: [] }))
  const result = await execute()({}, {})
  assert.deepEqual(result.items, [])
  assert.deepEqual(result.nothingAnnounced, [])
  assert.deepEqual(result.couldNotCheck, [])
  assert.deepEqual(result.counts, { shows: 0, scheduled: 0, nothingAnnounced: 0, couldNotCheck: 0 })
})

test('a named show is looked up in the scoped library, followed or not, and bounded', async () => {
  const seen: Array<{ sql: string; params: unknown[] }> = []
  mockPool((sql, params) => {
    seen.push({ sql, params })
    return { rows: [] }
  })
  const result = await execute()({ series: '  Severance ' }, {})

  assert.equal(result.answer, 'notInLibrary', 'out of scope answers like a missing show')
  assert.equal(seen.length, 1)
  assert.doesNotMatch(seen[0].sql, /user_watching_series/)
  assert.match(seen[0].sql, /unaccent\(s\.title\) ILIKE/)
  assert.match(seen[0].sql, /s\.provider_library_id = ANY/)
  assert.match(seen[0].sql, new RegExp(`LIMIT ${UPCOMING_MAX_NAME_MATCHES}`))
  assert.deepEqual(seen[0].params, ['%Severance%', 'Severance', ['lib-a'], 13])
})

test('a blank name asks about the followed list', async () => {
  const seen: string[] = []
  mockPool((sql) => {
    seen.push(sql)
    return { rows: [] }
  })
  const result = await execute()({ series: '   ' }, {})
  assert.equal(result.answer, 'notFollowing')
  assert.match(seen[0], /user_watching_series/)
})

test('a status a live lookup just wrote is the one reported', async () => {
  // TMDb's answer writes tmdb_status, so read before the lookup it would call a
  // show that has just ended still running.
  const id = '33333333-3333-4333-8333-333333333333'
  let stored: string | null = null
  mockPool((sql) => {
    if (sql.includes('FROM user_watching_series')) {
      return { rows: [{ id, title: 'Over', year: null, poster_url: null, genres: [], community_rating: null }] }
    }
    if (sql.includes('FROM system_settings')) return { rows: [{ value: 'key' }] }
    if (sql.includes('UPDATE series')) {
      stored = 'Ended'
      return { rows: [] }
    }
    if (sql.includes('SELECT id, tmdb_id FROM series')) return { rows: [{ id, tmdb_id: '987654' }] }
    if (sql.includes('SELECT id, tmdb_status FROM series')) return { rows: [{ id, tmdb_status: stored }] }
    return { rows: [] }
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({
      id: 987654,
      name: 'Over',
      next_episode_to_air: null,
      last_episode_to_air: null,
      number_of_episodes: 8,
      number_of_seasons: 1,
      seasons: [],
      status: 'Ended',
    })
  restores.push(() => {
    globalThis.fetch = realFetch
  })
  const result = await execute()({}, {})
  assert.equal(result.answer, 'nothingAnnounced')
  assert.deepEqual(result.nothingAnnounced, [{ title: 'Over', ended: true, latestAired: null }])
})

test('the answer is built from the shared lookups, with no key meaning no forecast', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  mockPool((sql) => {
    if (sql.includes('FROM user_watching_series')) return { rows: [show(id, { title: 'Followed' })] }
    if (sql.includes('FROM system_settings')) return { rows: [] }
    if (sql.includes('FROM series') && sql.includes('tmdb_id')) return { rows: [{ id, tmdb_id: '42' }] }
    return { rows: [] }
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('no key, so TMDb must not be asked')
  }
  restores.push(() => {
    globalThis.fetch = realFetch
  })
  const result = await execute()({}, {})
  assert.equal(result.answer, 'noTmdbKey')
  assert.deepEqual(result.couldNotCheck, [{ title: 'Followed', reason: 'noTmdbKey', latestAired: null }])
})

test('the composer\'s "unwatched only" mode leaves it alone', () => {
  // It reports on shows the viewer is by definition watching, so filtering on the
  // parent show would empty the answer.
  const run = async () => ({ items: [] })
  const wrapped = withUnwatchedFilter({ getUpcomingEpisodes: { execute: run } } as never, 'viewer-1') as {
    getUpcomingEpisodes: { execute: unknown }
  }
  assert.equal(wrapped.getUpcomingEpisodes.execute, run)
})

test('entering the tool reports its own phase', () => {
  const phases: string[] = []
  const wrapped = withStatusEvents(
    { getUpcomingEpisodes: { execute: () => 'done' } } as never,
    (phase) => phases.push(phase)
  ) as { getUpcomingEpisodes: { execute: () => unknown } }
  wrapped.getUpcomingEpisodes.execute()
  assert.deepEqual(phases, ['upcoming'])
})

test('a card survives the scope wrapper as the show it names', async () => {
  // Judged as a series by `id`, unlike an episode card judged by its parent.
  const id = '22222222-2222-4222-8222-222222222222'
  const asked: unknown[][] = []
  mockPool((sql, params) => {
    asked.push(params)
    return { rows: sql.includes('FROM series') ? [{ id }] : [] }
  })
  const { items } = answer({ shows: [show(id)], episodes: [episode(id, '2026-11-20')] })
  const kept = await filterItemsToScope(scope, items)
  assert.equal(kept.length, 1)
  assert.deepEqual(asked.at(-1)?.[0], [id])
})

test('a scope check that fails shows an error, not a stale answer over no cards', async () => {
  const id = '44444444-4444-4444-8444-444444444444'
  mockPool(() => {
    throw new Error('database down')
  })
  const { items, answer: kind } = answer({ shows: [show(id)], episodes: [episode(id, '2026-11-20')] })
  assert.equal(kind, 'scheduled')
  const tools = withToolErrorHandling(
    withLibraryScope(
      { getUpcomingEpisodes: { execute: async () => ({ items, answer: kind }) } } as never,
      scope
    )
  ) as { getUpcomingEpisodes: { execute: () => Promise<Record<string, unknown>> } }

  const result = await tools.getUpcomingEpisodes.execute()
  assert.equal(typeof result.error, 'string')
  // Fails closed: no card and no verdict about them gets through.
  assert.equal('items' in result, false)
  assert.equal('answer' in result, false)
})
