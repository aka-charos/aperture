import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRequestable, isStillRequestable, summarizeMissing } from './requestability.js'

const title = (over: Partial<Parameters<typeof isStillRequestable>[0]> = {}) => ({
  mediaType: 'movie' as 'movie' | 'series' | 'person',
  inLibrary: false,
  availability: 'unknown',
  requested: false,
  ...over,
})

test('a title in the library is not requestable', () => {
  assert.equal(isRequestable(title({ inLibrary: true })), false)
})

test('a title the backend already has is not requestable', () => {
  assert.equal(isRequestable(title({ mediaType: 'series', availability: 'available' })), false)
})

test('a partly available show can be asked for again', () => {
  assert.equal(isStillRequestable(title({ mediaType: 'series', availability: 'partially_available' })), true)
})

test('an already requested title keeps its control but is not still requestable', () => {
  const pending = title({ availability: 'pending', requested: true })
  assert.equal(isRequestable(pending), true)
  assert.equal(isStillRequestable(pending), false)
})

test('people are never requestable', () => {
  assert.equal(isRequestable(title({ mediaType: 'person' })), false)
})

test('summary counts only what Request would still do, films and shows apart', () => {
  const summary = summarizeMissing(
    [
      title({ inLibrary: true }),
      title(),
      title(),
      title({ requested: true, availability: 'processing' }),
      title({ mediaType: 'series' }),
      title({ mediaType: 'person' }),
    ],
    3,
    1
  )
  assert.deepEqual(summary, { movies: 2, series: 1, more: true })
})

test('the last page has nothing behind it', () => {
  assert.equal(summarizeMissing([], 1, 1).more, false)
  assert.equal(summarizeMissing([], 0, 1).more, false)
  assert.equal(summarizeMissing([], 3, 3).more, false)
})
