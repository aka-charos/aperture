import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  selectionRatio,
  genreWeightFromSelection,
  GENRE_PREFERENCE_BOUNDS,
} from './genrePreference.js'

/**
 * The live figures these tests are pinned against, from one viewer's 1,561-film
 * history on a real instance. They are what the audit measured and what the
 * formula has to keep reproducing.
 */
const LIVE_WATCHED_TOTAL = 1561

describe('selectionRatio', () => {
  it('is 1.0 when a genre is taken exactly as often as it is offered', () => {
    const ratio = selectionRatio({ watched: 100, available: 1000 }, 1000, 10000)
    assert.equal(ratio, 1)
  })

  it('reads above 1 for a genre taken more often than offered', () => {
    // 20% of what they watched, 10% of what is on the shelf.
    const ratio = selectionRatio({ watched: 200, available: 1000 }, 1000, 10000)
    assert.equal(ratio, 2)
  })

  it('reads below 1 for a genre taken less often than offered', () => {
    const ratio = selectionRatio({ watched: 50, available: 1000 }, 1000, 10000)
    assert.equal(ratio, 0.5)
  })

  it('separates volume from preference, which is the whole point', () => {
    // Comedy: large by raw count, but the library is fuller of it still. The
    // old engagement-share measure called this a favourite; this one does not.
    const comedy = selectionRatio({ watched: 300, available: 4000 }, LIVE_WATCHED_TOTAL, 12584)
    // Film noir: tiny by raw count, but they have taken most of what exists.
    const noir = selectionRatio({ watched: 9, available: 20 }, LIVE_WATCHED_TOTAL, 12584)

    assert.ok(comedy !== null && noir !== null)
    assert.ok(comedy! < 1, `comedy should read as under-selected, got ${comedy}`)
    assert.ok(noir! > 1, `noir should read as over-selected, got ${noir}`)
    assert.ok(noir! > comedy!, 'the smaller genre is the stronger preference here')
  })

  it('returns null rather than a number when the comparison is impossible', () => {
    assert.equal(selectionRatio({ watched: 5, available: 100 }, 0, 1000), null)
    assert.equal(selectionRatio({ watched: 5, available: 100 }, 100, 0), null)
    assert.equal(selectionRatio({ watched: 5, available: 0 }, 100, 1000), null)
    assert.equal(selectionRatio({ watched: 0, available: 100 }, 100, 1000), null)
    assert.equal(selectionRatio({ watched: NaN, available: 100 }, 100, 1000), null)
  })
})

describe('genreWeightFromSelection', () => {
  it('maps an unmeasurable ratio to exactly neutral', () => {
    // Not 0, and not "slightly penalised" -- by the time this reaches a score,
    // unmeasurable must be indistinguishable from indifferent.
    assert.equal(genreWeightFromSelection(null, 50), 1.0)
    assert.equal(genreWeightFromSelection(0, 50), 1.0)
    assert.equal(genreWeightFromSelection(Number.NaN, 50), 1.0)
  })

  it('maps a neutral ratio to exactly 1.0 at any sample size', () => {
    for (const n of [1, 10, 100, 5000]) {
      assert.equal(genreWeightFromSelection(1, n), 1.0)
    }
  })

  it('treats double and half as equal and opposite', () => {
    // The reason this works in log space. A linear scale would make "twice as
    // often" a bigger deviation than "half as often", which is not what a ratio
    // means.
    const n = 1_000_000
    const up = genreWeightFromSelection(2, n) - 1
    const down = 1 - genreWeightFromSelection(0.5, n)
    assert.ok(Math.abs(up - down) < 1e-6, `${up} vs ${down}`)
  })

  it('stays inside the declared band however extreme the ratio', () => {
    const n = 1_000_000
    for (const ratio of [0.0001, 0.01, 0.25, 4, 100, 10000]) {
      const w = genreWeightFromSelection(ratio, n)
      assert.ok(
        w >= GENRE_PREFERENCE_BOUNDS.min - 1e-9 && w <= GENRE_PREFERENCE_BOUNDS.max + 1e-9,
        `ratio ${ratio} produced ${w}, outside [${GENRE_PREFERENCE_BOUNDS.min}, ${GENRE_PREFERENCE_BOUNDS.max}]`
      )
    }
  })

  it('keeps the band the same width the old engagement formula used', () => {
    // The old base band was [0.8, 1.4] -- 0.6 wide. Correcting WHAT is measured
    // must not quietly change HOW HARD genre preference pushes, or neither
    // change could be evaluated.
    const width = GENRE_PREFERENCE_BOUNDS.max - GENRE_PREFERENCE_BOUNDS.min
    assert.ok(Math.abs(width - 0.6) < 1e-9, `band width is ${width}`)
  })

  it('barely moves on a thin history and nearly fully commits on a thick one', () => {
    const thin = genreWeightFromSelection(1.88, 2)
    const thick = genreWeightFromSelection(1.88, 365)

    assert.ok(thin > 1 && thin < 1.05, `two films should barely register, got ${thin}`)
    assert.ok(thick > 1.12, `365 films should nearly fully commit, got ${thick}`)
    assert.ok(thick > thin)
  })

  it('shrinks a thin library section too, not just a thin history', () => {
    // Nine of twenty film noirs is a ratio near 4, but nine films is nine
    // films. Both kinds of thinness look identical from here and get the same
    // treatment.
    const w = genreWeightFromSelection(4, 9)
    const confident = genreWeightFromSelection(4, 500)
    assert.ok(w < confident, 'a nine-film sample must not reach the ceiling')
    assert.ok(w > 1, 'but it should still read as a preference')
  })

  it('reproduces the live spread in the right order', () => {
    // Sample sizes are that viewer's actual per-genre film counts.
    const crime = genreWeightFromSelection(1.88, 365)
    const thriller = genreWeightFromSelection(1.52, 373)
    const drama = genreWeightFromSelection(1.14, 429)
    const comedy = genreWeightFromSelection(0.76, 183)
    const family = genreWeightFromSelection(0.39, 39)

    assert.ok(crime > thriller, 'crime is their strongest preference')
    assert.ok(thriller > drama)
    assert.ok(drama > 1, 'drama is mildly over-selected')
    assert.ok(comedy < 1, 'comedy is under-selected despite its raw volume')
    assert.ok(family < comedy, 'family is their weakest')
    assert.ok(family > GENRE_PREFERENCE_BOUNDS.min, 'and is not pinned at the floor')
  })

  it('is monotone in the ratio', () => {
    const n = 200
    let previous = -Infinity
    for (const ratio of [0.1, 0.25, 0.5, 0.8, 1, 1.25, 2, 4, 10]) {
      const w = genreWeightFromSelection(ratio, n)
      assert.ok(w >= previous, `ratio ${ratio} broke monotonicity`)
      previous = w
    }
  })
})
