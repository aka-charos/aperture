import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readInterestPick } from './interestPick'

test('a pick with evidence names the interest and its tags', () => {
  assert.deepEqual(
    readInterestPick({
      interestMatch: {
        interestId: 'i',
        interestText: 'dark comedy',
        evidence: { strength: 'phrase', matched: ['dark comedy'] },
      },
    }),
    { interest: 'dark comedy', tags: ['dark comedy'] }
  )
})

test('an older pick with only a similarity reads as unconfirmed', () => {
  assert.deepEqual(
    readInterestPick({ interestMatch: { interestText: 'dark comedy', weightedSimilarity: 0.614 } }),
    { interest: 'dark comedy', tags: null }
  )
})

test('anything that is not an interest pick reads as none', () => {
  for (const value of [null, {}, { interestMatch: null }, { interestMatch: { interestText: '' } }, { twinMatch: {} }]) {
    assert.equal(readInterestPick(value), null, JSON.stringify(value))
  }
})

test('junk tags are dropped, and no tags left means unconfirmed', () => {
  assert.deepEqual(
    readInterestPick({ interestMatch: { interestText: 'x', evidence: { matched: [7, ' ', 'noir'] } } }),
    { interest: 'x', tags: ['noir'] }
  )
  assert.deepEqual(
    readInterestPick({ interestMatch: { interestText: 'x', evidence: { matched: [] } } }),
    { interest: 'x', tags: null }
  )
})
