import assert from 'node:assert/strict'
import { test } from 'node:test'

import { displayRatingSql } from './displayRating.js'

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
