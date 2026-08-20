import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRatingsLine } from './imdbDataset.js'

/** The library, as far as the parser is concerned. */
const wanted = new Set(['tt33071426', 'tt0111161'])

test('reads a real row', () => {
  // Exactly the shape of the line that started this work, from the live file.
  assert.deepEqual(parseRatingsLine('tt33071426\t7.1\t112851', wanted), {
    imdbId: 'tt33071426',
    rating: 7.1,
    votes: 112851,
  })
})

test('skips titles we do not hold', () => {
  // ~99% of the file. If this ever stops being the first check, the pass gets
  // slower by more than the rest of the parser costs put together.
  assert.equal(parseRatingsLine('tt0000001\t5.7\t2138', wanted), null)
})

test('the header row falls out for free', () => {
  // No special case: "tconst" is not an IMDb id, so it is never in the set.
  assert.equal(parseRatingsLine('tconst\taverageRating\tnumVotes', wanted), null)
})

test('IMDb null markers are rejected', () => {
  assert.equal(parseRatingsLine('tt0111161\t\\N\t2138', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t9.3\t\\N', wanted), null)
})

test('an empty field is missing, never zero', () => {
  // Number('') is 0, not NaN. Without the explicit empty check a truncated line
  // would store a real 0.0 rating, which sorts below genuinely terrible films
  // instead of reading as absent.
  assert.equal(parseRatingsLine('tt0111161\t\t2138', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t9.3\t', wanted), null)
})

test('trailing garbage is rejected rather than salvaged', () => {
  // parseFloat('9.3abc') is 9.3; Number() refuses the whole string, which is
  // why the parser uses it.
  assert.equal(parseRatingsLine('tt0111161\t9.3abc\t2138', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t9.3\t21x38', wanted), null)
})

test('malformed lines are rejected, not guessed at', () => {
  assert.equal(parseRatingsLine('', wanted), null)
  assert.equal(parseRatingsLine('tt0111161', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t9.3', wanted), null)
  // A leading tab would make the id an empty string, which must not match.
  assert.equal(parseRatingsLine('\t9.3\t2138', wanted), null)
})

test('ratings outside 0-10 are rejected', () => {
  // The `movies` schema learned this the hard way with community ratings of
  // 101.00; a range check here is cheaper than clamping downstream.
  assert.equal(parseRatingsLine('tt0111161\t11\t2138', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t-1\t2138', wanted), null)
})

test('a fractional vote count is rejected', () => {
  // numVotes is an integer column; a non-integer means the line is not what we
  // think it is, and silently truncating would hide that.
  assert.equal(parseRatingsLine('tt0111161\t9.3\t2138.5', wanted), null)
  assert.equal(parseRatingsLine('tt0111161\t9.3\t-5', wanted), null)
})

test('the boundary values are kept', () => {
  assert.deepEqual(parseRatingsLine('tt0111161\t10\t1', wanted), {
    imdbId: 'tt0111161',
    rating: 10,
    votes: 1,
  })
  // A rating of 0 is legitimate; only an EMPTY field means missing.
  assert.deepEqual(parseRatingsLine('tt0111161\t0\t0', wanted), {
    imdbId: 'tt0111161',
    rating: 0,
    votes: 0,
  })
})

test('an empty library matches nothing', () => {
  assert.equal(parseRatingsLine('tt33071426\t7.1\t112851', new Set()), null)
})
