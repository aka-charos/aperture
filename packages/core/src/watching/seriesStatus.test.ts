import test from 'node:test'
import assert from 'node:assert/strict'
import { isEndedStatus } from './seriesStatus.js'

test('only the two final statuses mean a show is over', () => {
  assert.equal(isEndedStatus('Ended'), true)
  assert.equal(isEndedStatus('Canceled'), true)
  for (const status of ['Returning Series', 'In Production', 'Planned', 'Continuing', '', null, undefined]) {
    assert.equal(isEndedStatus(status), false, String(status))
  }
})
