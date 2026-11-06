/**
 * Pins the order of `semanticSearch`'s answer. Nothing here knows a rating: a
 * rating sort once sat between the query and the cut, so a close match was
 * dropped for scoring low and an unrated title went first, under a heading that
 * says "closest to".
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { keepNewTitles, mergeNearestByRank } from './semanticOrder.js'

const NO_ITEMS: string[] = []

describe('mergeNearestByRank', () => {
  test('one media type keeps the nearest-first order it arrived in, cut to the limit', () => {
    assert.deepEqual(mergeNearestByRank(['m1', 'm2', 'm3'], NO_ITEMS, 2), ['m1', 'm2'])
    assert.deepEqual(mergeNearestByRank(NO_ITEMS, ['s1', 's2', 's3'], 2), ['s1', 's2'])
  })

  test('two media types alternate by rank, movie first', () => {
    assert.deepEqual(mergeNearestByRank(['m1', 'm2', 'm3'], ['s1', 's2', 's3'], 6), [
      'm1',
      's1',
      'm2',
      's2',
      'm3',
      's3',
    ])
  })

  test('the limit applies after the merge, so it reaches both media types', () => {
    assert.deepEqual(mergeNearestByRank(['m1', 'm2', 'm3'], ['s1', 's2', 's3'], 3), [
      'm1',
      's1',
      'm2',
    ])
  })

  test('when one side runs short the other fills the remaining slots', () => {
    assert.deepEqual(mergeNearestByRank(['m1'], ['s1', 's2', 's3', 's4'], 4), [
      'm1',
      's1',
      's2',
      's3',
    ])
    assert.deepEqual(mergeNearestByRank(['m1', 'm2', 'm3', 'm4'], ['s1'], 4), [
      'm1',
      's1',
      'm2',
      'm3',
    ])
  })

  test('nothing found on either side is an empty list', () => {
    assert.deepEqual(mergeNearestByRank(NO_ITEMS, NO_ITEMS, 5), [])
  })
})

describe('keepNewTitles', () => {
  const rows = (...titles: string[]) => titles.map((title) => ({ title }))
  const titles = (kept: { title: string }[]) => kept.map((row) => row.title)

  test('keeps the order and drops a repeated title, ignoring case', () => {
    const kept = keepNewTitles(rows('Heat', 'Alien', 'HEAT', 'Ronin'), new Set())
    assert.deepEqual(titles(kept), ['Heat', 'Alien', 'Ronin'])
  })

  test('drops the excluded title by substring, and it does not take up a later rank', () => {
    const kept = keepNewTitles(rows('Alien', 'Aliens', 'Heat'), new Set(), 'alien')
    assert.deepEqual(titles(kept), ['Heat'])
  })

  test('the movie wins when a movie and a series share a title', () => {
    const seen = new Set<string>()
    const movies = keepNewTitles(rows('Fargo', 'Heat'), seen)
    const series = keepNewTitles(rows('The Wire', 'fargo', 'Oz'), seen)
    assert.deepEqual(titles(movies), ['Fargo', 'Heat'])
    assert.deepEqual(titles(series), ['The Wire', 'Oz'])
  })
})
