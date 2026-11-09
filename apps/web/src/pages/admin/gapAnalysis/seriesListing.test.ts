import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSeriesRequestItems,
  gapCount,
  matchesKind,
  matchesNetworks,
  networkOptions,
  NO_NETWORK,
  requestableSeasons,
  seasonKey,
  showMatchesSearch,
  sortSeriesGaps,
  type SeasonStanding,
  type SeriesGapSeason,
  type SeriesGapShow,
} from './seriesListing'

function season(seasonNumber: number, standing: SeasonStanding, requestable = false): SeriesGapSeason {
  return { seasonNumber, airDate: null, posterPath: null, airedEpisodes: 10, heldEpisodes: 0, standing, requestable }
}

function show(id: number, title: string, partial: Partial<SeriesGapShow> = {}): SeriesGapShow {
  return {
    tmdbId: id,
    title,
    posterPath: null,
    networks: [],
    libraryId: null,
    rating: null,
    genres: [],
    numberingDiffers: false,
    seasons: [],
    total: 4,
    owned: 3,
    missing: 1,
    partial: 0,
    pending: 0,
    ...partial,
  }
}

test('the kind filter counts its own seasons', () => {
  const s = show(1, 'A', { missing: 2, partial: 1 })
  assert.equal(gapCount(s, 'missing'), 2)
  assert.equal(gapCount(s, 'partial'), 1)
  assert.equal(gapCount(s, 'both'), 3)
  assert.equal(gapCount(s, 'numbering'), 0)
})

test('a show appears only under a kind it has', () => {
  const partialOnly = show(1, 'A', { missing: 0, partial: 2 })
  assert.equal(matchesKind(partialOnly, 'missing'), false)
  assert.equal(matchesKind(partialOnly, 'partial'), true)
  assert.equal(matchesKind(partialOnly, 'both'), true)
  assert.equal(matchesKind(partialOnly, 'numbering'), false)

  const pendingOnly = show(2, 'B', { missing: 0, partial: 0, pending: 2 })
  assert.equal(matchesKind(pendingOnly, 'both'), false, 'everything on its way leaves nothing to act on')

  const doubted = show(3, 'C', { missing: 0, partial: 0, numberingDiffers: true })
  assert.equal(matchesKind(doubted, 'numbering'), true)
  assert.equal(matchesKind(doubted, 'both'), false)
})

test('a show on two networks is found under either, and no selection means all', () => {
  const s = show(1, 'A', { networks: ['HBO', 'Max'] })
  assert.equal(matchesNetworks(s, []), true)
  assert.equal(matchesNetworks(s, ['Max']), true)
  assert.equal(matchesNetworks(s, ['Netflix', 'HBO']), true)
  assert.equal(matchesNetworks(s, ['Netflix']), false)
})

test('a show with no network is found under its own entry', () => {
  const s = show(1, 'A')
  assert.equal(matchesNetworks(s, [NO_NETWORK]), true)
  assert.equal(matchesNetworks(s, ['HBO']), false)
  assert.equal(matchesNetworks(show(2, 'B', { networks: ['HBO'] }), [NO_NETWORK]), false)
})

test('network options count shows, most first, and keep an emptied selection', () => {
  const options = networkOptions(
    [
      show(1, 'A', { networks: ['HBO', 'Max'] }),
      show(2, 'B', { networks: ['HBO'] }),
      show(3, 'C'),
    ],
    ['Netflix']
  )
  assert.deepEqual(options, [
    { name: 'HBO', count: 2 },
    { name: NO_NETWORK, count: 1 },
    { name: 'Max', count: 1 },
    { name: 'Netflix', count: 0 },
  ])
})

test('search ignores case and accents', () => {
  assert.equal(showMatchesSearch(show(1, 'Élite'), 'elite'), true)
  assert.equal(showMatchesSearch(show(1, 'Élite'), '  '), true)
  assert.equal(showMatchesSearch(show(1, 'Élite'), 'wire'), false)
})

test('sorting reads the count for the filter in force', () => {
  const near = show(1, 'Near', { total: 10, owned: 9, missing: 1, partial: 0 })
  const far = show(2, 'Far', { total: 10, owned: 2, missing: 3, partial: 5 })
  const names = (kind: 'missing' | 'partial' | 'both', sort: 'closest' | 'mostMissing' | 'name') =>
    sortSeriesGaps([near, far], sort, kind).map((s) => s.title)
  assert.deepEqual(names('both', 'closest'), ['Near', 'Far'])
  assert.deepEqual(names('both', 'mostMissing'), ['Far', 'Near'])
  assert.deepEqual(names('both', 'name'), ['Far', 'Near'])
  assert.deepEqual(
    sortSeriesGaps([show(1, 'A', { missing: 1 }), show(2, 'B', { missing: 3 })], 'mostMissing', 'partial').map((s) => s.title),
    ['A', 'B'],
    'a tie on this filter falls back to the name'
  )
})

test('a row requests the seasons of the filter in force, and only requestable ones', () => {
  const s = show(1, 'A', {
    seasons: [
      season(1, 'owned'),
      season(2, 'missing', true),
      season(3, 'partial', true),
      season(4, 'partial', false),
      season(5, 'seerr'),
    ],
  })
  const numbers = (kind: 'missing' | 'partial' | 'both' | 'numbering') =>
    requestableSeasons(s, kind).map((x) => x.seasonNumber)
  assert.deepEqual(numbers('missing'), [2])
  assert.deepEqual(numbers('partial'), [3])
  assert.deepEqual(numbers('both'), [2, 3])
  assert.deepEqual(numbers('numbering'), [])
})

test('a selection becomes one request per show, naming its seasons', () => {
  const a = show(1, 'A', { seasons: [season(2, 'missing', true), season(3, 'missing', true), season(4, 'seerr')] })
  const b = show(2, 'B', { seasons: [season(1, 'missing', true)] })
  const c = show(3, 'C', { seasons: [season(1, 'missing', true)] })
  const items = buildSeriesRequestItems(
    [a, b, c],
    new Set([seasonKey(1, 2), seasonKey(1, 3), seasonKey(1, 4), seasonKey(2, 1)])
  )
  assert.deepEqual(items, [
    { tmdbId: 1, mediaType: 'series', title: 'A', seasons: [2, 3] },
    { tmdbId: 2, mediaType: 'series', title: 'B', seasons: [1] },
  ])
})
