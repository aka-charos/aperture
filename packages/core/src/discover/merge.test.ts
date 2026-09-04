import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeWithPool, fillFromPoolRow } from './merge.js'
import type { RawCandidate } from './types.js'

/** A bare Trakt-shaped candidate: no rating, no poster, no genres. */
function traktCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    tmdbId: 550,
    imdbId: null,
    title: 'Fight Club',
    originalTitle: null,
    originalLanguage: null,
    overview: null,
    releaseYear: 1999,
    posterPath: null,
    backdropPath: null,
    genres: [],
    voteAverage: 0,
    voteCount: 0,
    popularity: 0,
    source: 'trakt_recommendations',
    ...overrides,
  }
}

/** A pool row the global fetch already enriched. */
function poolRow(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    tmdbId: 550,
    imdbId: 'tt0137523',
    title: 'Fight Club',
    originalTitle: 'Fight Club',
    originalLanguage: 'en',
    overview: 'A ticking-time-bomb insomniac.',
    releaseYear: 1999,
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    genres: [{ id: 18, name: 'Drama' }],
    voteAverage: 8.4,
    voteCount: 27000,
    popularity: 61.4,
    source: 'tmdb_discover',
    poolId: 'pool-row-1',
    isEnriched: true,
    castMembers: [{ id: 819, name: 'Edward Norton', character: 'The Narrator', profilePath: null }],
    directors: ['David Fincher'],
    runtimeMinutes: 139,
    tagline: 'Mischief. Mayhem. Soap.',
    ...overrides,
  }
}

test('a personalized candidate keeps its own source and gains the pool rating', () => {
  const [merged] = mergeWithPool([traktCandidate()], [poolRow()])

  // Provenance is the whole point of the precedence.
  assert.equal(merged.source, 'trakt_recommendations')

  // ...and this is what was being thrown away.
  assert.equal(merged.voteAverage, 8.4)
  assert.equal(merged.voteCount, 27000)
  assert.equal(merged.posterPath, '/poster.jpg')
  assert.equal(merged.backdropPath, '/backdrop.jpg')
  assert.equal(merged.overview, 'A ticking-time-bomb insomniac.')
  assert.equal(merged.originalLanguage, 'en')
  assert.equal(merged.imdbId, 'tt0137523')
  assert.deepEqual(merged.genres, [{ id: 18, name: 'Drama' }])
})

test('popularity stays with the source that measured it', () => {
  // The pool's 61.4 is TMDb's unbounded metric; the candidate's 0 is
  // trakt_recommendations having no popularity signal at all. Taking the pool's
  // number under the Trakt label would file a TMDb-scaled value in a group of
  // zeros, and popularityScoresBySource would normalise it to 1.0.
  const [merged] = mergeWithPool([traktCandidate()], [poolRow()])
  assert.equal(merged.popularity, 0)
})

test('cached enrichment is carried across so the run does not pay for it twice', () => {
  const [merged] = mergeWithPool([traktCandidate()], [poolRow()])

  assert.equal(merged.isEnriched, true)
  assert.equal(merged.poolId, 'pool-row-1')
  assert.equal(merged.directors?.[0], 'David Fincher')
  assert.equal(merged.runtimeMinutes, 139)
  assert.equal(merged.tagline, 'Mischief. Mayhem. Soap.')
})

test('an enriched flag without the cast to back it is not trusted', () => {
  // enrichFullData skips on the flag, so a true here with no cast ships a blank
  // card that nothing will ever fill in.
  const merged = fillFromPoolRow(
    traktCandidate(),
    poolRow({ isEnriched: true, castMembers: [] })
  )
  assert.equal(merged.isEnriched, false)
})

test('the candidate wins wherever it actually has a value', () => {
  const merged = fillFromPoolRow(
    traktCandidate({
      posterPath: '/personalized.jpg',
      voteAverage: 7.1,
      voteCount: 12,
      genres: [{ id: 28, name: 'Action' }],
      overview: 'From the personalized fetch.',
    }),
    poolRow()
  )

  assert.equal(merged.posterPath, '/personalized.jpg')
  assert.equal(merged.voteAverage, 7.1)
  assert.equal(merged.voteCount, 12)
  assert.deepEqual(merged.genres, [{ id: 28, name: 'Action' }])
  assert.equal(merged.overview, 'From the personalized fetch.')
})

test('a personalized candidate with no pool row is passed through untouched', () => {
  const candidate = traktCandidate({ tmdbId: 999 })
  const [merged] = mergeWithPool([candidate], [poolRow()])
  assert.deepEqual(merged, candidate)
})

test('pool candidates the personalized fetch did not return are appended', () => {
  const merged = mergeWithPool([traktCandidate({ tmdbId: 1 })], [poolRow({ tmdbId: 2 })])

  assert.equal(merged.length, 2)
  assert.equal(merged[0].tmdbId, 1)
  assert.equal(merged[1].tmdbId, 2)
})

test('a title returned by both appears once, on the personalized side', () => {
  const merged = mergeWithPool([traktCandidate()], [poolRow()])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].source, 'trakt_recommendations')
})

test('a title repeated within the personalized list appears once', () => {
  const merged = mergeWithPool(
    [
      traktCandidate({ source: 'trakt_recommendations' }),
      traktCandidate({ source: 'tmdb_similar' }),
    ],
    []
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0].source, 'trakt_recommendations')
})

test('a release year of zero is not mistaken for a missing one', () => {
  // `??` rather than `||` on this field: releaseYear is a number, and while 0 is
  // not a real year it is also not what "absent" looks like here (that is null).
  const merged = fillFromPoolRow(
    traktCandidate({ releaseYear: null }),
    poolRow({ releaseYear: 1999 })
  )
  assert.equal(merged.releaseYear, 1999)
})
