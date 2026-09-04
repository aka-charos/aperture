import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidateCanonicalText, centreVector, l2Normalize } from './embeddings.js'
import { popularityScoresBySource } from './scorer.js'
import type { RawCandidate } from './types.js'

function candidate(partial: Partial<RawCandidate> = {}): RawCandidate {
  return {
    tmdbId: 1,
    imdbId: null,
    title: 'A Film',
    originalTitle: null,
    originalLanguage: 'en',
    overview: null,
    releaseYear: 2020,
    posterPath: null,
    backdropPath: null,
    genres: [],
    voteAverage: 0,
    voteCount: 0,
    popularity: 0,
    source: 'tmdb_discover',
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// buildCandidateCanonicalText
// ---------------------------------------------------------------------------

test('the document mirrors buildCanonicalText section labels', () => {
  // The labels are literal shared strings across every library document, so a
  // candidate using different ones would sit in a different register on top of
  // the fields it is already missing.
  const text = buildCandidateCanonicalText(
    candidate({
      title: 'Heat',
      tagline: 'A Los Angeles crime saga',
      directors: ['Michael Mann'],
      castMembers: [
        { id: 1, name: 'Al Pacino', character: 'Hanna', profilePath: null },
        { id: 2, name: 'Robert De Niro', character: 'McCauley', profilePath: null },
      ],
      overview: 'A crew of professional robbers.',
    }),
    ['Crime', 'Drama']
  )

  assert.match(text, /^Heat\n/)
  assert.match(text, /"A Los Angeles crime saga"/)
  assert.match(text, /Genres: Crime, Drama/)
  assert.match(text, /Directed by Michael Mann/)
  assert.match(text, /Starring Al Pacino, Robert De Niro/)
  assert.match(text, /A crew of professional robbers\./)
})

test('the release year is absent, matching the library document', () => {
  // buildCanonicalText deliberately omits it so it cannot act as a literal era
  // token; a candidate carrying one would be the only document in the space
  // that does.
  const text = buildCandidateCanonicalText(candidate({ title: 'Aniara', releaseYear: 2018 }), [])
  assert.ok(!text.includes('2018'), text)
})

test('missing fields are omitted rather than emitted empty', () => {
  const text = buildCandidateCanonicalText(candidate({ title: 'Bare' }), [])
  assert.equal(text, 'Bare')
})

test('only the first three cast members appear', () => {
  const text = buildCandidateCanonicalText(
    candidate({
      castMembers: [1, 2, 3, 4, 5].map((n) => ({
        id: n,
        name: `Actor ${n}`,
        character: 'x',
        profilePath: null,
      })),
    }),
    []
  )
  assert.match(text, /Starring Actor 1, Actor 2, Actor 3$/m)
  assert.ok(!text.includes('Actor 4'))
})

test('the same inputs always produce the same document', () => {
  // The cache key is a hash of this text, so a non-deterministic builder would
  // re-embed every candidate on every run.
  const c = candidate({ title: 'X', overview: 'y', directors: ['D'] })
  assert.equal(buildCandidateCanonicalText(c, ['A']), buildCandidateCanonicalText(c, ['A']))
})

// ---------------------------------------------------------------------------
// centreVector
// ---------------------------------------------------------------------------

test('centring normalises before subtracting', () => {
  // refreshCenteredEmbeddings stores l2_normalize(v) - mean. Centring is a
  // subtraction, not a rescale, so a long vector must not be rotated by a
  // different amount than a short one.
  const mean = [0.1, 0.1]
  const short = centreVector([1, 0], mean)!
  const long = centreVector([100, 0], mean)!

  assert.ok(Math.abs(short[0] - long[0]) < 1e-12, `${short[0]} vs ${long[0]}`)
  assert.ok(Math.abs(short[1] - long[1]) < 1e-12)
})

test('a dimension mismatch refuses rather than producing a shorter vector', () => {
  assert.equal(centreVector([1, 0, 0], [0.1, 0.1]), null)
})

test('l2Normalize leaves a zero vector alone rather than dividing by zero', () => {
  assert.deepEqual(l2Normalize([0, 0]), [0, 0])
})

// ---------------------------------------------------------------------------
// popularityScoresBySource
// ---------------------------------------------------------------------------

test('a source with no popularity signal scores neutral, not zero', () => {
  // trakt_popular and trakt_recommendations hardcode popularity 0. Scored
  // against TMDb's unbounded metric they landed at exactly 0 on a term carrying
  // a large share of the ranking -- burying the source the code itself calls
  // "most personalized". Within their own source every value is identical, so
  // they resolve to 0.5: no signal, not "unpopular".
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'tmdb_discover', popularity: 2000 }),
    candidate({ tmdbId: 2, source: 'tmdb_discover', popularity: 10 }),
    candidate({ tmdbId: 3, source: 'trakt_recommendations', popularity: 0 }),
    candidate({ tmdbId: 4, source: 'trakt_popular', popularity: 0 }),
  ])

  assert.equal(scores.get(3), 0.5)
  assert.equal(scores.get(4), 0.5)

  // The two-member group keeps its ORDER but not the full range: two
  // observations do not establish one. Endpoints are deliberately not asserted
  // here -- that is the confidence shrinkage's own test.
  assert.ok(scores.get(1)! > 0.5, `expected above neutral, got ${scores.get(1)}`)
  assert.ok(scores.get(2)! < 0.5, `expected below neutral, got ${scores.get(2)}`)
})

test('a watcher count is ranked within its own source, not against TMDb', () => {
  // Trakt trending carries watchers (tens to hundreds) while TMDb carries an
  // unbounded float. Pooled, every Trakt title collapsed to ~0; per source the
  // internal ordering survives and is rescaled onto the same 0-1.
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'tmdb_discover', popularity: 5000 }),
    candidate({ tmdbId: 2, source: 'trakt_trending', popularity: 500 }),
    candidate({ tmdbId: 3, source: 'trakt_trending', popularity: 250 }),
    candidate({ tmdbId: 4, source: 'trakt_trending', popularity: 10 }),
  ])

  // The internal ordering is the thing being preserved. Pooled against TMDb's
  // unbounded metric all three would have collapsed to the same floor.
  assert.ok(scores.get(2)! > scores.get(3)!)
  assert.ok(scores.get(3)! > scores.get(4)!)
  assert.ok(scores.get(2)! > 0.5 && scores.get(4)! < 0.5)

  // The lone TMDb candidate has no spread of its own, so it is neutral rather
  // than top -- and unaffected by anything happening inside the Trakt group.
  assert.equal(scores.get(1), 0.5)
})

test('a lone candidate in a source is neutral rather than top', () => {
  // One value means no spread, so there is nothing to rank it against.
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'trakt_trending', popularity: 42 }),
  ])
  assert.equal(scores.get(1), 0.5)
})

test('every candidate gets a score', () => {
  const candidates = [
    candidate({ tmdbId: 1, source: 'tmdb_discover', popularity: 1 }),
    candidate({ tmdbId: 2, source: 'tmdb_similar', popularity: 2 }),
    candidate({ tmdbId: 3, source: 'trakt_popular', popularity: 0 }),
  ]
  const scores = popularityScoresBySource(candidates)
  for (const c of candidates) {
    const score = scores.get(c.tmdbId)
    assert.ok(score !== undefined && score >= 0 && score <= 1, `${c.tmdbId} -> ${score}`)
  }
})

test('the number is grouped by who measured it, not by who recommended it', () => {
  // The live case, with the measured figures. A pool row lists every source
  // that ever offered the title and `sources[0]` -- which becomes `source` --
  // was not even in a stable order, while `popularity` holds whichever source
  // last supplied a figure. 16 of 279 pooled movies listed a Trakt source first
  // while carrying a TMDb-scaled number.
  //
  // Grouped by `source`, tmdbId 3 sits alone in a trakt_trending group and
  // min-max hands it 0.5 -- or 1.0 with company -- when against the TMDb scale
  // it belongs near the floor.
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'tmdb_discover', popularitySource: 'tmdb_discover', popularity: 901.11 }),
    candidate({ tmdbId: 2, source: 'tmdb_discover', popularitySource: 'tmdb_discover', popularity: 28.01 }),
    candidate({ tmdbId: 3, source: 'trakt_trending', popularitySource: 'tmdb_discover', popularity: 33.01 }),
  ])

  // The counterfactual is what makes this sharp. Grouped by `source`, tmdbId 3
  // is alone in a trakt_trending group, min equals max, and it scores EXACTLY
  // 0.5. Grouped by who measured the number it sits near the floor with tmdbId
  // 2, because (33.01 - 28.01) / (901.11 - 28.01) is 0.006. Anything clearly
  // below neutral can only have come from the correct grouping.
  assert.ok(scores.get(3)! < 0.45, `expected a floor-adjacent score, got ${scores.get(3)}`)
  assert.ok(
    Math.abs(scores.get(3)! - scores.get(2)!) < Math.abs(scores.get(3)! - scores.get(1)!),
    'the mislabelled row belongs with the floor, not the ceiling'
  )
  assert.ok(scores.get(1)! > scores.get(3)!)
})

test('an unlabelled figure falls back to the source that recommended it', () => {
  // A pool row written before migration 0162 and not since re-upserted. Absent
  // means "the same source", which is true of anything straight from a fetcher.
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'trakt_trending', popularity: 500 }),
    candidate({ tmdbId: 2, source: 'trakt_trending', popularity: 10 }),
    candidate({ tmdbId: 3, source: 'tmdb_discover', popularity: 5000 }),
  ])

  assert.ok(scores.get(1)! > 0.5)
  assert.ok(scores.get(2)! < 0.5)
  assert.equal(scores.get(3), 0.5)
})

test('a thin source does not get the same range as a deep one', () => {
  // Min-max makes group size irrelevant to the scale: three candidates and 128
  // each produce exactly one 1.0 and one 0.0, so being the most-watched of
  // three Trakt trending titles scored identically to being the most popular of
  // 128 TMDb ones. Measured on a live run, that three-member ceiling was an
  // obscure TV movie the taste model scored 0.30, sitting beside Forrest Gump.
  const thin = [
    candidate({ tmdbId: 1, source: 'trakt_trending', popularity: 300 }),
    candidate({ tmdbId: 2, source: 'trakt_trending', popularity: 200 }),
    candidate({ tmdbId: 3, source: 'trakt_trending', popularity: 100 }),
  ]
  const deep = Array.from({ length: 128 }, (_, i) =>
    candidate({ tmdbId: 1000 + i, source: 'tmdb_discover', popularity: i })
  )

  const scores = popularityScoresBySource([...thin, ...deep])

  const thinTop = scores.get(1)!
  const deepTop = scores.get(1000 + 127)!

  assert.ok(deepTop > thinTop, `deep ceiling ${deepTop} should beat thin ceiling ${thinTop}`)
  // n/(n+10): 3/13 = 0.231 of the range, so the top of three lands near 0.62.
  assert.ok(thinTop > 0.55 && thinTop < 0.70, `thin ceiling out of band: ${thinTop}`)
  // 128/138 = 0.928, so a deep group keeps nearly all of its range.
  assert.ok(deepTop > 0.9, `deep ceiling should stay near the top: ${deepTop}`)

  // Ordering inside the thin group survives being damped -- it is scaled toward
  // neutral, not flattened.
  assert.ok(scores.get(1)! > scores.get(2)!)
  assert.ok(scores.get(2)! > scores.get(3)!)
})

test('shrinkage is symmetric about neutral, so it cannot invent a preference', () => {
  const scores = popularityScoresBySource([
    candidate({ tmdbId: 1, source: 'tmdb_discover', popularity: 100 }),
    candidate({ tmdbId: 2, source: 'tmdb_discover', popularity: 0 }),
  ])

  const above = scores.get(1)! - 0.5
  const below = 0.5 - scores.get(2)!
  assert.ok(Math.abs(above - below) < 1e-12, 'the pull toward neutral must be even')
})
