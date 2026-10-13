import test from 'node:test'
import assert from 'node:assert/strict'
import { libraryEpisodeCountSql, seriesCompletionRate } from './libraryEpisodes.js'
import { completionMultiplier } from '../../taste-profile/builder.js'

test('no library total reads as "cannot tell", which leaves the weight alone', () => {
  assert.equal(seriesCompletionRate(5, null), undefined)
  assert.equal(seriesCompletionRate(5, undefined), undefined)
  assert.equal(seriesCompletionRate(5, 0), undefined)
  assert.equal(completionMultiplier(seriesCompletionRate(5, null)), 1.0)
})

test('counts arriving as pg strings are read as numbers', () => {
  assert.equal(seriesCompletionRate('6', '24'), 0.25)
})

test('a show dropped early lands in the penalty bands, a finished one in the top band', () => {
  assert.equal(completionMultiplier(seriesCompletionRate(2, 60)), 0.25)
  assert.equal(completionMultiplier(seriesCompletionRate(8, 60)), 0.4)
  assert.equal(completionMultiplier(seriesCompletionRate(60, 60)), 1.5)
})

test('a watched count above the library total is clamped at 1', () => {
  assert.equal(seriesCompletionRate(30, 24), 1)
})

test('nothing regular watched (only specials, or a bookmark) is a rate of 0, not unknown', () => {
  assert.equal(seriesCompletionRate(0, 24), 0)
  assert.equal(seriesCompletionRate(null, 24), 0)
})

test('the denominator leaves out specials and correlates on the expression given', () => {
  const sql = libraryEpisodeCountSql('s.id')
  assert.match(sql, /le\.series_id = s\.id/)
  assert.match(sql, /le\.season_number > 0/)
  assert.match(sql, /NULLIF\(COUNT\(\*\), 0\)/)
})
