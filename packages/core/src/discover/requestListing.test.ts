import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REQUEST_SORTS,
  REQUEST_STATUS_GROUPS,
  isRequestSort,
  isRequestStatusGroup,
  requestOrderSql,
  requestStatusGroupSql,
} from './requestListing.js'

test('every stored status belongs to exactly one group, split on the library only when available', () => {
  const stored = ['pending', 'submitted', 'approved', 'declined', 'available', 'failed']
  for (const status of stored) {
    const owners = REQUEST_STATUS_GROUPS.filter((g) => requestStatusGroupSql(g, 'r').includes(`'${status}'`))
    if (status === 'available') {
      assert.deepEqual(owners, ['downloaded', 'inLibrary'])
    } else {
      assert.equal(owners.length, 1, `${status} -> ${owners.join(', ')}`)
    }
  }
  assert.match(requestStatusGroupSql('downloaded', 'r'), /AND NOT \(CASE/)
  assert.match(requestStatusGroupSql('inLibrary', 'r'), /AND \(CASE/)
})

test('every order ends on the row id, so pages never overlap', () => {
  for (const sort of REQUEST_SORTS) {
    assert.match(requestOrderSql(sort, 'r'), /r\.id (ASC|DESC)$/)
  }
})

test('unknown values are not groups or sorts', () => {
  assert.equal(isRequestStatusGroup('available'), false)
  assert.equal(isRequestStatusGroup('inLibrary'), true)
  assert.equal(isRequestSort('created_at'), false)
  assert.equal(isRequestSort('oldest'), true)
  assert.equal(isRequestSort(undefined), false)
})
