import test from 'node:test'
import assert from 'node:assert/strict'
import { PLOT_CHARS, buildCanonicalText, CANONICAL_TEXT_VERSION, MOVIE_STALE_SQL } from './embeddings.js'
import { SERIES_STALE_SQL } from '../series/embeddings.js'

/**
 * The canonical text is the only thing an embedding sees, so a column absent
 * from it contributes nothing to similarity, semantic search, the recommender's
 * candidate retrieval or the Explore graph — however well populated it is.
 *
 * It read `tags` and `awards` (media-server sync) while `keywords` and
 * `awards_summary` (enrichment) sat unused in adjacent columns. `keywords` is
 * the expensive miss: TMDb keywords are where "film noir" is actually written
 * down, and a semantic search for a style had only plot prose to match on.
 */

type Movie = Parameters<typeof buildCanonicalText>[0]

function movie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: 'm1',
    title: 'Ascenseur pour l\'échafaud',
    year: 1958,
    genres: ['Crime', 'Drama'],
    overview: 'A murder plan unravels over one night in Paris.',
    tagline: null,
    directors: ['Louis Malle'],
    actors: null,
    studios: null,
    contentRating: null,
    tags: null,
    productionCountries: ['France'],
    awards: null,
    keywords: null,
    collectionName: null,
    composers: null,
    cinematographers: null,
    languages: null,
    awardsSummary: null,
    plotFull: null,
    ...overrides,
  } as Movie
}

// ============================================================================
// Which synopsis gets embedded
// ============================================================================

test('the long synopsis replaces the short one, it does not join it', () => {
  // Both tell the same story. Including both would weight plot twice over
  // against genre, crew and keywords — the fields that say what a film *is*.
  const overview = 'A murder plan unravels over one night in Paris.'
  const plotFull =
    'A young executive and his lover plot to kill her husband, but a jammed lift ' +
    'traps him in the building overnight while a joyriding couple takes his car.'
  const text = buildCanonicalText(movie({ overview, plotFull }))
  assert.match(text, /jammed lift/)
  assert.doesNotMatch(text, /unravels over one night/)
})

test('a full plot no longer than the overview is ignored', () => {
  // OMDb answers plot=full with the short blurb when IMDb has no long synopsis,
  // so "we got a value back" is not evidence that it is worth having.
  const overview = 'A long and reasonably detailed overview sentence from the media server.'
  const text = buildCanonicalText(movie({ overview, plotFull: 'Short.' }))
  assert.match(text, /media server/)
  assert.doesNotMatch(text, /Short\./)
})

test('the long synopsis is used when there is no overview at all', () => {
  const text = buildCanonicalText(movie({ overview: null, plotFull: 'The whole story.' }))
  assert.match(text, /The whole story\./)
})

test('a very long synopsis is capped, but well past the setup', () => {
  // 1000 characters kept the FIRST thousand, which for a real IMDb synopsis is
  // the setup — the most interchangeable part of any story — so long-plot films
  // were made to look more alike, not less. Uncapped is the opposite error:
  // plot_full only exists where OMDb had one, so a 12,000-character document
  // and a 250-character one stop being comparable.
  const text = buildCanonicalText(movie({ plotFull: 'x'.repeat(20000) }))
  assert.ok(text.length > PLOT_CHARS, 'the cap must not be cutting into the setup')
  assert.ok(text.length < PLOT_CHARS + 500, 'and the rest of the text is a rounding error beside it')
  assert.match(text, /\.\.\./)
})

test('a synopsis inside the cap is untouched and gains no ellipsis', () => {
  const synopsis = 'A murder plan unravels over one night in Paris.'
  const text = buildCanonicalText(movie({ plotFull: synopsis, overview: null }))
  assert.match(text, /unravels over one night in Paris/)
  assert.doesNotMatch(text, /\.\.\./)
})

// ============================================================================
// The enrichment fields reach the text
// ============================================================================

test('TMDb keywords are embedded', () => {
  const text = buildCanonicalText(movie({ keywords: ['film noir', 'jazz score', 'paris'] }))
  assert.match(text, /film noir/)
  assert.match(text, /jazz score/)
})

test('spoken languages are embedded, separately from country', () => {
  // Country does not imply language: a French-language Belgian film and an
  // English-language French co-production read very differently.
  const text = buildCanonicalText(movie({ languages: ['French'] }))
  assert.match(text, /From France/)
  assert.match(text, /In French/)
})

test('collection membership is embedded', () => {
  const text = buildCanonicalText(movie({ collectionName: 'Wrong Turn Collection' }))
  assert.match(text, /Part of Wrong Turn Collection/)
})

test('photography is embedded and the score is not', () => {
  // Six of the fields here were proper nouns tied to a nationality against
  // three describing what the film is like, which is how Metropolis came back
  // nearest to Das Boot. Photography survives that as a style signal; a single
  // composer credit, appearing on two or three titles in the whole library,
  // contributes nothing to similarity except nationality.
  const text = buildCanonicalText(
    movie({ composers: ['Miles Davis'], cinematographers: ['Henri Decaë'] })
  )
  assert.match(text, /Cinematography by Henri Decaë/)
  assert.doesNotMatch(text, /Music by/)
  assert.doesNotMatch(text, /Miles Davis/)
})

test('awards never reach the vector, from either source', () => {
  // Same rule that keeps scores out: quality has its own blend term. Worse,
  // awards text hands every awarded title the tokens "Won"/"Oscars", so award
  // films cluster with award films regardless of subject.
  const text = buildCanonicalText(
    movie({ awards: "Palme d'Or winner", awardsSummary: 'Won 4 Oscars. 12 nominations.' })
  )
  assert.doesNotMatch(text, /Won 4 Oscars/)
  assert.doesNotMatch(text, /Palme d'Or/)
  assert.doesNotMatch(text, /Awards:/)
})

test('the content rating never reaches the vector', () => {
  // "NR" means nobody submitted it to the MPAA, which tracks age and non-US
  // origin rather than anything about the work — and as a literal shared string
  // it makes an era-and-nationality detector out of every old foreign title.
  for (const contentRating of ['NR', 'R', 'PG-13']) {
    const text = buildCanonicalText(movie({ contentRating }))
    assert.doesNotMatch(text, /Rated/)
    assert.doesNotMatch(text, new RegExp(contentRating))
  }
})

// ============================================================================
// What must stay out
// ============================================================================

test('absent fields add no empty sections', () => {
  // Every enrichment field null. A bare "Keywords: " label with nothing after
  // it is noise in the vector, and a section that appears for every row
  // regardless of content carries no information at all.
  const text = buildCanonicalText(movie())
  assert.doesNotMatch(text, /Keywords:/)
  assert.doesNotMatch(text, /Part of/)
  assert.doesNotMatch(text, /Cinematography by/)
  assert.doesNotMatch(text, /\bIn\s*$/)
  // No section is emitted with an empty value.
  assert.doesNotMatch(text, /:\s*(\.|$)/)
  assert.doesNotMatch(text, /\.\s*$/)
})

test('a keyword avalanche cannot drown the rest of the text', () => {
  const many = Array.from({ length: 80 }, (_, i) => `keyword${i}`)
  const text = buildCanonicalText(movie({ keywords: many }))
  assert.match(text, /keyword0/)
  assert.doesNotMatch(text, /keyword40/)
})

// ============================================================================
// Determinism — the skip-unchanged guard is built on it
// ============================================================================

test('the same input produces byte-identical text', () => {
  // The embedding job compares a freshly built text against the stored one to
  // decide whether to pay for a new vector. Any instability here — iteration
  // order, a timestamp, a locale-dependent join — re-embeds the whole library
  // on every run and quietly bills for it.
  const input = movie({
    keywords: ['film noir', 'jazz score'],
    languages: ['French'],
    composers: ['Miles Davis'],
    awardsSummary: 'Won 4 Oscars.',
  })
  assert.equal(buildCanonicalText(input), buildCanonicalText(input))
})

test('adding an enrichment field changes the text', () => {
  // The other half of the same contract: an enrichment pass that fills in
  // keywords must be detected as a change, or the vector never catches up.
  const before = buildCanonicalText(movie())
  const after = buildCanonicalText(movie({ keywords: ['film noir'] }))
  assert.notEqual(before, after)
})

test('the version is a positive integer', () => {
  // Stored as text_version; NULL means "before versioning" and must sort below
  // it, so 0 would make every pre-existing row look current.
  assert.ok(Number.isInteger(CANONICAL_TEXT_VERSION))
  assert.ok(CANONICAL_TEXT_VERSION > 0)
})

// ============================================================================
// The staleness predicate
// ============================================================================

/**
 * Each predicate is spliced into two queries with different parameter lists —
 * the selection ends in `LIMIT $2`, the count has no LIMIT at all. A fragment
 * that names a placeholder therefore forces one of them to pass a parameter it
 * never references, and Postgres rejects the statement outright rather than
 * ignoring it: `42P18 could not determine data type of parameter $2`. That is
 * how both embedding jobs shipped broken — nothing in lint, typecheck or these
 * tests touches a database, so the first execution was on the live instance.
 */
for (const [name, sql] of [
  ['movies', MOVIE_STALE_SQL],
  ['series', SERIES_STALE_SQL],
] as const) {
  test(`the ${name} staleness predicate binds no parameters`, () => {
    assert.doesNotMatch(sql, /\$\d/)
  })

  test(`the ${name} staleness predicate compares against the current version`, () => {
    // Interpolated, so a version bump has to reach the SQL text itself.
    assert.match(sql, new RegExp(`text_version, 0\\) < ${CANONICAL_TEXT_VERSION}\\b`))
  })
}
