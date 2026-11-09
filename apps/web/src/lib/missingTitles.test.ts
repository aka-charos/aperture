import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMissing, requestSearchPath } from './missingTitles'

test('nothing to offer without a summary or with nothing in it', () => {
  assert.equal(hasMissing(null), false)
  assert.equal(hasMissing(undefined), false)
  assert.equal(hasMissing({ movies: 0, series: 0, more: true }), false)
})

test('one film or one show is something to offer', () => {
  assert.equal(hasMissing({ movies: 1, series: 0, more: false }), true)
  assert.equal(hasMissing({ movies: 0, series: 1, more: false }), true)
})

test('the request path carries the trimmed query, encoded', () => {
  assert.equal(requestSearchPath('  the godfather & co '), '/my-requests?q=the%20godfather%20%26%20co')
})
