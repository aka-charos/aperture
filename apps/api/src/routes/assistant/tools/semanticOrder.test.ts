/**
 * Pins the order of `semanticSearch`'s answer. Nothing here knows a rating: a
 * rating sort once sat between the query and the cut, so a close match was
 * dropped for rating low, and an unrated title counted as 0 and sank to the
 * bottom, under a heading that says "closest to".
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mergeNearestByRank } from './semanticOrder.js'

const cards = (...names: string[]) => names.map((name) => ({ name }))
const merged = (
  movies: string[],
  series: string[],
  limit: number,
  excludeLower?: string
): string[] =>
  mergeNearestByRank(cards(...movies), cards(...series), limit, excludeLower).map((c) => c.name)

describe('mergeNearestByRank', () => {
  test('one media type keeps the nearest-first order it arrived in, cut to the limit', () => {
    assert.deepEqual(merged(['m1', 'm2', 'm3'], [], 2), ['m1', 'm2'])
    assert.deepEqual(merged([], ['s1', 's2', 's3'], 2), ['s1', 's2'])
  })

  test('two media types alternate by rank, movie first', () => {
    assert.deepEqual(merged(['m1', 'm2', 'm3'], ['s1', 's2', 's3'], 6), [
      'm1',
      's1',
      'm2',
      's2',
      'm3',
      's3',
    ])
  })

  test('the limit applies after the merge, so it reaches both media types', () => {
    assert.deepEqual(merged(['m1', 'm2', 'm3'], ['s1', 's2', 's3'], 3), ['m1', 's1', 'm2'])
  })

  test('when one side runs short the other fills the remaining slots', () => {
    assert.deepEqual(merged(['m1'], ['s1', 's2', 's3', 's4'], 4), ['m1', 's1', 's2', 's3'])
    assert.deepEqual(merged(['m1', 'm2', 'm3', 'm4'], ['s1'], 4), ['m1', 's1', 'm2', 'm3'])
  })

  test('nothing found, or no room, is an empty list', () => {
    assert.deepEqual(merged([], [], 5), [])
    assert.deepEqual(merged(['m1'], ['s1'], 0), [])
    assert.deepEqual(merged(['m1'], ['s1'], -1), [])
  })
})

describe('mergeNearestByRank titles', () => {
  test('a title repeated on one side appears once, and the repeat uses no turn', () => {
    assert.deepEqual(merged(['Heat', 'HEAT', 'Ronin'], ['s1', 's2'], 4), [
      'Heat',
      's1',
      'Ronin',
      's2',
    ])
  })

  test('the excluded title is left out by substring, and uses no turn', () => {
    assert.deepEqual(merged(['Alien', 'Aliens', 'Heat'], ['s1', 's2'], 3, 'alien'), [
      'Heat',
      's1',
      's2',
    ])
  })

  test('the movie wins a shared title at the same rank', () => {
    assert.deepEqual(merged(['Fargo', 'Heat'], ['fargo', 'The Wire'], 3), [
      'Fargo',
      'The Wire',
      'Heat',
    ])
  })

  test('the movie wins a shared title when it ranks nearer', () => {
    assert.deepEqual(merged(['Fargo', 'Heat'], ['The Wire', 'fargo', 'Oz'], 4), [
      'Fargo',
      'The Wire',
      'Heat',
      'Oz',
    ])
  })

  test('a shared title is not lost when the movie copy ranks past the limit', () => {
    // Dropping the series for the movie before the cut would leave this title
    // in neither half: the film sits past the limit, and it is the closest show.
    const result = merged(['m1', 'm2', 'm3', 'Fargo'], ['Fargo', 's2'], 4)
    assert.deepEqual(result, ['m1', 'Fargo', 'm2', 's2'])
  })

  test('the series keeps a shared title when it ranks nearer', () => {
    assert.deepEqual(merged(['m1', 'Fargo', 'm3'], ['fargo', 's2'], 5), [
      'm1',
      'fargo',
      'm3',
      's2',
    ])
  })
})
