import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSpaceFor,
  centeringNeeded,
  embeddingColumnFor,
  resolveEmbeddingSpace,
  type EmbeddingSpace,
} from './centering.js'

test('each space names its own column', () => {
  assert.equal(embeddingColumnFor('raw'), 'embedding')
  assert.equal(embeddingColumnFor('centered'), 'embedding_centered')
})

test('a raw profile stays raw even once centring is available', () => {
  // The safety property of the whole rollout: filling the centred column
  // changes nothing until a profile is deliberately rebuilt. So the migration
  // and backfill can ship without moving anyone's recommendations, and
  // rebuilding profiles from the raw column is the entire rollback.
  assert.equal(resolveEmbeddingSpace('raw', true), 'raw')
  assert.equal(resolveEmbeddingSpace('raw', false), 'raw')
})

test('a centred profile is served from the centred column', () => {
  assert.equal(resolveEmbeddingSpace('centered', true), 'centered')
})

test('a centred profile with no centred data REFUSES rather than falling back', () => {
  // Falling back to raw here is the mixed-space bug: a centroid built in one
  // space compared against items in another produces a confident ranking that
  // means nothing. The caller's correct response is to rebuild the profile.
  assert.equal(resolveEmbeddingSpace('centered', false), null)
})

test('the two sides of every served comparison agree', () => {
  // Swept rather than asserted case by case, because "the spaces match" is the
  // one property this module exists to guarantee.
  const spaces: EmbeddingSpace[] = ['raw', 'centered']
  for (const profileSpace of spaces) {
    for (const ready of [true, false]) {
      const served = resolveEmbeddingSpace(profileSpace, ready)
      if (served === null) continue
      assert.equal(
        served,
        profileSpace,
        `serving ${profileSpace} profile from ${served} column crosses spaces`
      )
    }
  }
})

test('a new profile is built centred exactly when centring is usable', () => {
  assert.equal(buildSpaceFor(true), 'centered')
  assert.equal(buildSpaceFor(false), 'raw')
})

test('a profile built now is immediately servable', () => {
  // buildSpaceFor and resolveEmbeddingSpace are separate functions and could
  // drift into disagreeing; a build that produces an unservable profile would
  // strand the user with no recommendations at all.
  for (const ready of [true, false]) {
    const built = buildSpaceFor(ready)
    assert.equal(resolveEmbeddingSpace(built, ready), built)
  }
})

// --- when an embedding pass has to rewrite the centred column ---------------
//
// Both embedding jobs ask this, and they run on a six-hour interval that
// usually finds nothing. Getting it wrong in one direction rewrites ~77 MB of
// table four times a day to produce identical vectors; in the other it leaves
// centred profiles refusing until someone notices.

/** A settled column of `rows` titles, which the gate should leave alone. */
const settled = (rows: number) => ({ generated: 0, ready: true, rows, centredRows: rows })

test('new vectors always force a re-centre', () => {
  // They land with embedding_centered NULL, which alone makes the column
  // unready, and they move the mean the rest of the column was centred against.
  assert.equal(centeringNeeded({ ...settled(12589), generated: 1 }), true)
  assert.equal(centeringNeeded({ ...settled(12589), generated: 4200 }), true)
})

test('an unready column is repaired even when nothing was generated', () => {
  // This is what makes a failed centring self-healing rather than permanent:
  // the next scheduled pass sees an unready column and retries by itself.
  assert.equal(centeringNeeded({ ...settled(12589), ready: false }), true)
})

test('nothing generated against a settled column skips the rewrite', () => {
  assert.equal(centeringNeeded(settled(12589)), false)
})

test('rows leaving force a re-centre even though nothing is NULL', () => {
  // The deletion case, and the only one where the column looks complete and is
  // still wrong. Embedding rows are ON DELETE CASCADE from movies/series, so a
  // title dropped from the media server takes its vector with it: nothing was
  // generated, nothing is NULL, and the mean still counts the departed films.
  assert.equal(centeringNeeded({ generated: 0, ready: true, rows: 12000, centredRows: 12589 }), true)
  // One row is enough. There is no threshold here on purpose — a fraction that
  // "matters" is a number nobody has measured, and the check costs a COUNT
  // against a rewrite it only triggers when something really changed.
  assert.equal(centeringNeeded({ generated: 0, ready: true, rows: 12588, centredRows: 12589 }), true)
})

test('a count that never got recorded reads as needing work', () => {
  // An instance upgrading into this check has no previous observation. That
  // costs one rewrite, once; trusting a column whose history cannot be seen
  // costs a stale mean until the next re-embed, which may be never.
  assert.equal(centeringNeeded({ generated: 0, ready: true, rows: 12589, centredRows: null }), true)
})

test('growth that somehow left no NULLs is still drift', () => {
  // Not a path this codebase takes today — new rows land NULL — but the gate
  // compares counts rather than assuming the direction, because a future
  // writer that centres on insert would otherwise slip past every condition.
  assert.equal(centeringNeeded({ generated: 0, ready: true, rows: 13000, centredRows: 12589 }), true)
})
