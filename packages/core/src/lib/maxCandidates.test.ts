import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampedMaxCandidates } from './recommendationConfig.js'

// A null return means "leave the stored value alone".

test('a limit above the library is lowered to the library size', () => {
  assert.equal(clampedMaxCandidates(50000, 12584), 12584)
  assert.equal(clampedMaxCandidates(16000, 12584), 12584)
})

test('a limit at or below the library is left alone', () => {
  assert.equal(clampedMaxCandidates(12584, 12584), null)
  assert.equal(clampedMaxCandidates(2000, 12584), null)
})

test('a library that grew does not raise the admin choice', () => {
  // Scoring 2,000 of 20,000 titles is an explicit decision about how much
  // compute a run costs. Silently restoring it to the new library size would
  // spend that compute without being asked.
  assert.equal(clampedMaxCandidates(2000, 20000), null)
})

test('an unsynced library never clamps the setting to nothing', () => {
  // Mid-first-sync the table is empty, and a 0 ceiling would leave the
  // recommender unable to retrieve a single candidate.
  assert.equal(clampedMaxCandidates(50000, 0), null)
  assert.equal(clampedMaxCandidates(50000, -1), null)
})

test('the series case is the one that was 50x oversized', () => {
  // series_embeddings holds one vector per show, not per episode.
  assert.equal(clampedMaxCandidates(50000, 987), 987)
})
