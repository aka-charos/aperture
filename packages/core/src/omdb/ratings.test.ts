import test from 'node:test'
import assert from 'node:assert/strict'
import { extractRatingsData } from './ratings.js'
import type { OMDbMovieResponse } from './types.js'

/**
 * OMDb encodes absence as the string "N/A" and numbers as display text, so
 * every field here is a parse rather than a read. Both failure modes are
 * silent: "N/A" coerced to 0 puts unrated titles at the bottom of every sort,
 * and a thousands separator swallowed by parseFloat turns 545,163 votes into
 * 545 — a number that looks entirely plausible on a badge.
 */

function response(overrides: Partial<OMDbMovieResponse> = {}): OMDbMovieResponse {
  return {
    Title: 'The Devil Wears Prada',
    Response: 'True',
    imdbRating: '7.0',
    imdbVotes: '545,163',
    Metascore: '62',
    Plot: 'A young woman lands a job at a fashion magazine.',
    Awards: 'Nominated for 2 Oscars. 21 wins & 53 nominations total',
    Language: 'English, French',
    Country: 'United States, France',
    Ratings: [{ Source: 'Rotten Tomatoes', Value: '75%' }],
    ...overrides,
  } as OMDbMovieResponse
}

// ============================================================================
// IMDb rating and votes
// ============================================================================

test('the IMDb rating is parsed as a number', () => {
  assert.equal(extractRatingsData(response()).imdbRating, 7.0)
})

test('grouped vote counts survive the separator', () => {
  // parseFloat('545,163') is 545. The separators have to be stripped first.
  assert.equal(extractRatingsData(response()).imdbVotes, 545163)
})

test('a seven-figure vote count parses', () => {
  const data = extractRatingsData(response({ imdbVotes: '2,145,890' }))
  assert.equal(data.imdbVotes, 2145890)
})

test('N/A is absence, not zero', () => {
  // A zero rating would sort below every genuinely bad film in the library.
  const data = extractRatingsData(response({ imdbRating: 'N/A', imdbVotes: 'N/A' }))
  assert.equal(data.imdbRating, null)
  assert.equal(data.imdbVotes, null)
})

test('missing fields are null rather than NaN', () => {
  const data = extractRatingsData(response({ imdbRating: undefined, imdbVotes: undefined }))
  assert.equal(data.imdbRating, null)
  assert.equal(data.imdbVotes, null)
})

// ============================================================================
// The long plot
// ============================================================================

test('the plot is carried through', () => {
  assert.match(extractRatingsData(response()).plot ?? '', /fashion magazine/)
})

test('an N/A plot is null, not the literal string', () => {
  assert.equal(extractRatingsData(response({ Plot: 'N/A' })).plot, null)
})

// ============================================================================
// Nothing else regressed
// ============================================================================

test('the existing fields still parse', () => {
  const data = extractRatingsData(response())
  assert.equal(data.rtCriticScore, 75)
  assert.equal(data.metacriticScore, 62)
  assert.deepEqual(data.languages, ['English', 'French'])
  assert.deepEqual(data.countries, ['United States', 'France'])
  assert.match(data.awardsSummary ?? '', /Nominated for 2 Oscars/)
})

// ============================================================================
// Country vocabulary
//
// OMDb writes "USA" and "UK" where the media server writes "United States of
// America" and "United Kingdom". Both land in the same column, which is how
// one library ended up holding four spellings of the United States across
// 5,720 titles. Canonicalising at the point of extraction stops the two
// vocabularies from ever meeting.
// ============================================================================

test('OMDb country abbreviations are canonicalised', () => {
  const data = extractRatingsData(response({ Country: 'USA, UK' }))
  assert.deepEqual(data.countries, ['United States', 'United Kingdom'])
})

test('two spellings of one country collapse to one entry', () => {
  const data = extractRatingsData(response({ Country: 'USA, United States' }))
  assert.deepEqual(data.countries, ['United States'])
})

test('a country OMDb names in a way we do not know is left alone', () => {
  const data = extractRatingsData(response({ Country: 'Wakanda' }))
  assert.deepEqual(data.countries, ['Wakanda'])
})

test('historic states survive extraction', () => {
  const data = extractRatingsData(response({ Country: 'West Germany, Soviet Union' }))
  assert.deepEqual(data.countries, ['West Germany', 'Soviet Union'])
})

test('absent countries stay null so enrichment does not wipe the column', () => {
  // The UPDATE is `COALESCE($13, production_countries)`. An empty array here
  // would overwrite whatever the media server already wrote.
  assert.equal(extractRatingsData(response({ Country: 'N/A' })).countries, null)
  assert.equal(extractRatingsData(response({ Country: '' })).countries, null)
})
