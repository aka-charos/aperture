import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCanonicalText, CANONICAL_TEXT_VERSION } from './embeddings.js'

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
    ...overrides,
  } as Movie
}

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

test('below-the-line crew is embedded', () => {
  const text = buildCanonicalText(
    movie({ composers: ['Miles Davis'], cinematographers: ['Henri Decaë'] })
  )
  assert.match(text, /Music by Miles Davis/)
  assert.match(text, /Cinematography by Henri Decaë/)
})

test("OMDb's awards summary wins over the media server's free text", () => {
  const text = buildCanonicalText(
    movie({ awards: 'Some awards', awardsSummary: 'Won 4 Oscars. 12 nominations.' })
  )
  assert.match(text, /Won 4 Oscars/)
  assert.doesNotMatch(text, /Some awards/)
})

test('the media server awards text is still used when OMDb has none', () => {
  const text = buildCanonicalText(movie({ awards: 'Palme d\'Or winner' }))
  assert.match(text, /Palme d'Or winner/)
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
  assert.doesNotMatch(text, /Music by/)
  assert.doesNotMatch(text, /Cinematography by/)
  assert.doesNotMatch(text, /Awards:/)
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
