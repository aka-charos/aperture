/**
 * Pins the ranking for chat's search over the scored pool.
 *
 * The failure this guards against is silent: a blend where one term is pinned
 * still returns a plausible-looking ordered list, it just isn't using half its
 * inputs. That exact shape has already appeared three times in this codebase
 * (avgNovelty in [0.8,1.0], dispersion at 0.000 for every profile, centroid
 * cosine at 0.898-0.993), so it gets a test rather than a comment.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { blendQueryAndTaste, QUERY_WEIGHT } from './tasteBlend.js'

const row = (id: string, queryScore: number, tasteScore: number) => ({ id, queryScore, tasteScore })

describe('blendQueryAndTaste', () => {
  test('a compressed term still moves the ranking', () => {
    // Query scores span a hundredth; taste spans a half. Blended raw, taste
    // would decide everything and the request would be decoration.
    const rows = [
      row('a', 0.7401, 0.2),
      row('b', 0.7402, 0.9),
      row('c', 0.7500, 0.25),
    ]
    const ranked = blendQueryAndTaste(rows)

    // 'c' has by far the best query fit and mediocre taste; it must not be
    // buried under 'b' simply because taste happened to have a wider range.
    assert.equal(ranked[0]!.id, 'c')
  })

  test('the request outweighs taste at the default weight', () => {
    const ranked = blendQueryAndTaste([row('onTopic', 1, 0), row('onTaste', 0, 1)])

    assert.equal(QUERY_WEIGHT > 0.5, true)
    assert.equal(ranked[0]!.id, 'onTopic')
  })

  test('taste breaks the tie when two titles answer the request equally', () => {
    const ranked = blendQueryAndTaste([row('worse', 0.8, 0.1), row('better', 0.8, 0.9)])

    assert.equal(ranked[0]!.id, 'better')
  })

  test('a term with no spread contributes nothing instead of NaN', () => {
    // Every candidate equally on-topic: taste alone must decide, and no score
    // may come back NaN from dividing by a zero range.
    const ranked = blendQueryAndTaste([row('a', 0.5, 0.2), row('b', 0.5, 0.8)])

    assert.equal(ranked[0]!.id, 'b')
    for (const r of ranked) assert.equal(Number.isFinite(r.blendedScore), true)
  })

  test('both terms flat leaves the input order untouched', () => {
    const ranked = blendQueryAndTaste([row('a', 0.5, 0.5), row('b', 0.5, 0.5), row('c', 0.5, 0.5)])

    assert.deepEqual(
      ranked.map((r) => r.id),
      ['a', 'b', 'c']
    )
  })

  test('weight 1 ignores taste and weight 0 ignores the request', () => {
    const rows = [row('onTopic', 1, 0), row('onTaste', 0, 1)]

    assert.equal(blendQueryAndTaste(rows, 1)[0]!.id, 'onTopic')
    assert.equal(blendQueryAndTaste(rows, 0)[0]!.id, 'onTaste')
  })

  test('a non-finite or out-of-range weight falls back to the default', () => {
    const rows = [row('onTopic', 1, 0), row('onTaste', 0, 1)]

    assert.equal(blendQueryAndTaste(rows, NaN)[0]!.id, 'onTopic')
    // Clamped, not wrapped: 2 behaves as 1, not as something that inverts.
    assert.equal(blendQueryAndTaste(rows, 2)[0]!.id, 'onTopic')
    assert.equal(blendQueryAndTaste(rows, -1)[0]!.id, 'onTaste')
  })

  test('ties keep the order the ANN returned them in', () => {
    const ranked = blendQueryAndTaste([row('first', 0.9, 0.5), row('second', 0.9, 0.5)])

    assert.deepEqual(
      ranked.map((r) => r.id),
      ['first', 'second']
    )
  })

  test('an empty pool produces nothing', () => {
    assert.deepEqual(blendQueryAndTaste([]), [])
  })
})
