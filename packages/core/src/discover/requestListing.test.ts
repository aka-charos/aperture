import test from 'node:test'
import assert from 'node:assert/strict'
import { binderFor, type LibraryScope } from '../lib/libraryScope.js'
import {
  REQUEST_SORTS,
  REQUEST_STATUS_GROUPS,
  isRequestSort,
  isRequestStatusGroup,
  requestLibraryTitleSql,
  requestOrderSql,
  requestStatusGroupSql,
} from './requestListing.js'

const scope: LibraryScope = { libraryIds: ['lib-a'], maxParentalRating: 7, hasMovies: true, hasSeries: true }

test('every stored status belongs to exactly one group, split on the library only when available', () => {
  const stored = ['pending', 'submitted', 'approved', 'declined', 'available', 'failed']
  for (const status of stored) {
    const owners = REQUEST_STATUS_GROUPS.filter((g) =>
      requestStatusGroupSql(g, 'r', null, binderFor([])).includes(`'${status}'`)
    )
    if (status === 'available') {
      assert.deepEqual(owners, ['downloaded', 'inLibrary'])
    } else {
      assert.equal(owners.length, 1, `${status} -> ${owners.join(', ')}`)
    }
  }
  const library = requestLibraryTitleSql('r', null, binderFor([]))
  assert.equal(requestStatusGroupSql('downloaded', 'r', null, binderFor([])), `(r.status = 'available' AND ${library} IS NULL)`)
  assert.equal(requestStatusGroupSql('inLibrary', 'r', null, binderFor([])), `(r.status = 'available' AND ${library} IS NOT NULL)`)
})

test("the library test is the viewer's scope, bound for both media types", () => {
  const params: unknown[] = []
  const sql = requestLibraryTitleSql('r', scope, binderFor(params))
  // Ids and rating bound once per table, never written into the text.
  assert.deepEqual(params, [['lib-a'], 7, ['lib-a'], 7])
  assert.match(sql, /lm\.provider_library_id = ANY\(\$1::text\[\]\)/)
  assert.match(sql, /ls\.provider_library_id = ANY\(\$3::text\[\]\)/)
  assert.doesNotMatch(sql, /lib-a/)
  // No scope restricts nothing and binds nothing.
  const none: unknown[] = []
  assert.doesNotMatch(requestLibraryTitleSql('r', null, binderFor(none)), /provider_library_id/)
  assert.deepEqual(none, [])
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
