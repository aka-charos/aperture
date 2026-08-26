import test from 'node:test'
import assert from 'node:assert/strict'

import { decideStatus, type EmbeddingSetPending } from './embeddingSets.js'

const pending = (total: number): EmbeddingSetPending => ({
  movies: total,
  series: 0,
  episodes: 0,
  total,
})

test('a fully generated set reads ready', () => {
  assert.equal(decideStatus(12584, pending(0)), 'ready')
})

test('a set with work left reads incomplete', () => {
  assert.equal(decideStatus(12584, pending(37)), 'incomplete')
})

test('a populated set with no measurement reads unknown, never ready', () => {
  // The asymmetry is the point: reporting an unmeasured set as ready tells an
  // admin the switch is free when it may cost a full library re-embed.
  assert.equal(decideStatus(12584, null), 'unknown')
})

test('an empty set reads empty even without a measurement', () => {
  // The model an admin just selected has written nothing yet. "Nothing stored"
  // is the fact they need; "unknown" would hide it behind a measurement that
  // cannot say anything a zero row count has not already said.
  assert.equal(decideStatus(0, null), 'empty')
})

test('an empty set stays empty even when pending was measured', () => {
  assert.equal(decideStatus(0, pending(12584)), 'empty')
})

test('a set that is fully populated by count can still be incomplete', () => {
  // A row count cannot answer readiness on its own. Every title has a vector
  // here, but CANONICAL_TEXT_VERSION moved, so the job would rebuild them all.
  assert.equal(decideStatus(12584, pending(12584)), 'incomplete')
})
