import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupPicksByDonor,
  SERIES_SHARED_MIN_COMPLETION,
  storedSharedFields,
  TWIN_SHARED_ORDER_NEAREST,
} from './twinNearShared.js'

test('picks borrowed from one twin share one shared-set lookup', () => {
  const grouped = groupPicksByDonor([
    { itemId: 'synecdoche', donorId: 'k1a' },
    { itemId: 'stalker', donorId: 'other' },
    { itemId: 'anomalisa', donorId: 'k1a' },
  ])

  assert.deepEqual([...grouped.entries()], [
    ['k1a', ['synecdoche', 'anomalisa']],
    ['other', ['stalker']],
  ])
})

test('a pick listed twice is looked up once', () => {
  const grouped = groupPicksByDonor([
    { itemId: 'a', donorId: 'd' },
    { itemId: 'a', donorId: 'd' },
  ])
  assert.deepEqual(grouped.get('d'), ['a'])
})

test('stored fields carry ids, similarities and the order together', () => {
  assert.deepEqual(
    storedSharedFields([
      { id: 'anomalisa', similarity: 0.81 },
      { id: 'eternal', similarity: 0.77 },
    ]),
    {
      sharedIds: ['anomalisa', 'eternal'],
      sharedSimilarities: [0.81, 0.77],
      sharedOrder: 'nearest',
    }
  )
})

test('nothing to show stores nothing, so no order is claimed for absent ids', () => {
  // The refresh writes this over the old rarest-first fields; an empty object
  // is what removes them rather than replacing them with an empty claim.
  assert.deepEqual(storedSharedFields([]), {})
  assert.deepEqual(storedSharedFields(undefined), {})
})

test('a show counts as watched from half the library episodes', () => {
  // completionMultiplier's committed band starts above 0.5; reaching half
  // counts here, so a single sampled episode never does.
  assert.equal(SERIES_SHARED_MIN_COMPLETION, 0.5)
})

test('the order marker is the literal readers compare against', () => {
  // Stored in score_breakdown JSONB and read back by the API's twinShared.ts;
  // renaming it silently turns every current run back into "no titles".
  assert.equal(TWIN_SHARED_ORDER_NEAREST, 'nearest')
})
