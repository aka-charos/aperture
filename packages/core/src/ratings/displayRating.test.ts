import assert from 'node:assert/strict'
import { test } from 'node:test'

import { displayRatingAtLeastSql, displayRatingSql } from './displayRating.js'

test('aliased and unaliased forms read the stored pair, falling back while not computed', () => {
  assert.equal(
    displayRatingSql('m'),
    '(CASE WHEN m.quality_rating_sources IS NULL THEN m.community_rating ELSE m.quality_rating END)'
  )
  assert.equal(
    displayRatingSql(),
    '(CASE WHEN quality_rating_sources IS NULL THEN community_rating ELSE quality_rating END)'
  )
})

test('anything but an identifier is refused, since the alias is interpolated', () => {
  for (const bad of ['', 'm;', 'm.x', '1m', 'm DROP', "m'"]) {
    assert.throws(() => displayRatingSql(bad), /not a table alias/, bad)
  }
})

test('a minimum is one comparison per branch of the CASE, on columns with statistics', () => {
  assert.equal(
    displayRatingAtLeastSql('m', '$4'),
    '((m.quality_rating_sources IS NULL AND m.community_rating >= $4) ' +
      'OR (m.quality_rating_sources IS NOT NULL AND m.quality_rating >= $4))'
  )
  assert.equal(
    displayRatingAtLeastSql(undefined, '$1'),
    '((quality_rating_sources IS NULL AND community_rating >= $1) ' +
      'OR (quality_rating_sources IS NOT NULL AND quality_rating >= $1))'
  )
})

test('a minimum follows the same fallback as the rating it stands for', () => {
  const sql = displayRatingAtLeastSql('m', '$1')
  // Not computed reads the media server's; computed, even as unrated, never does.
  assert.ok(sql.includes('m.quality_rating_sources IS NULL AND m.community_rating'))
  assert.ok(sql.includes('m.quality_rating_sources IS NOT NULL AND m.quality_rating'))
  assert.ok(!sql.includes('IS NOT NULL AND m.community_rating'))
})

test('a minimum takes only an alias and a placeholder, since both are interpolated', () => {
  for (const bad of ['', 'm;', 'm.x', "m'"]) {
    assert.throws(() => displayRatingAtLeastSql(bad, '$1'), /not a table alias/, bad)
  }
  for (const bad of ['7', '$0', '$1; DROP', '', '$a']) {
    assert.throws(() => displayRatingAtLeastSql('m', bad), /not a placeholder/, bad)
  }
})
