import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRating, qualityCaption } from './qualityCaption'

test('no basis from an older API says nothing new', () => {
  assert.deepEqual(qualityCaption(undefined), { from: null, note: null })
})

test('a current score names its rating as the headline prints it', () => {
  assert.deepEqual(qualityCaption({ current: true, rating: 6.94, scoredRating: null }), {
    from: { key: 'qualityFrom', values: { rating: '6.9' } },
    note: null,
  })
})

test('a current score on an unrated title says it got the default', () => {
  assert.deepEqual(qualityCaption({ current: true, rating: null, scoredRating: null }), {
    from: { key: 'qualityUnrated' },
    note: null,
  })
})

test('a stale score names both ratings (the live case)', () => {
  assert.deepEqual(qualityCaption({ current: false, rating: 6.94, scoredRating: 6.8 }), {
    from: null,
    note: { key: 'qualityScoredOn', values: { scored: '6.8', rating: '6.9' } },
  })
})

test('a stale score whose old rating cannot be known still warns', () => {
  assert.deepEqual(qualityCaption({ current: false, rating: 7.1, scoredRating: null }), {
    from: null,
    note: { key: 'qualityScoredOnUnknown', values: { rating: '7.1' } },
  })
})

test('a title that lost its rating names the old one, or stays quiet', () => {
  assert.deepEqual(qualityCaption({ current: false, rating: null, scoredRating: 6.8 }), {
    from: null,
    note: { key: 'qualityScoredOnOnly', values: { scored: '6.8' } },
  })
  assert.deepEqual(qualityCaption({ current: false, rating: null, scoredRating: null }), { from: null, note: null })
})

test('ratings print to one decimal, whole numbers included', () => {
  assert.equal(formatRating(7), '7.0')
  assert.equal(formatRating(6.94), '6.9')
})
