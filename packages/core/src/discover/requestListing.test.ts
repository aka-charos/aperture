import test from 'node:test'
import assert from 'node:assert/strict'
import { binderFor, type LibraryScope } from '../lib/libraryScope.js'
import {
  REQUEST_SORTS,
  REQUEST_STATUS_GROUPS,
  groupReadsLibrary,
  isRequestSort,
  isRequestStatusGroup,
  requestLibraryJoinSql,
  requestOrderSql,
  requestStatusGroupSql,
  statusGroupKey,
} from './requestListing.js'

const scope: LibraryScope = { libraryIds: ['lib-a'], maxParentalRating: 7, hasMovies: true, hasSeries: true }
const STORED = ['pending', 'submitted', 'approved', 'declined', 'available', 'failed']

test('every stored status belongs to exactly one group, split on the library only when available', () => {
  for (const status of STORED) {
    const owners = REQUEST_STATUS_GROUPS.filter((g) => requestStatusGroupSql(g, 'r').includes(`'${status}'`))
    if (status === 'available') {
      assert.deepEqual(owners, ['downloaded', 'inLibrary'])
    } else {
      assert.equal(owners.length, 1, `${status} -> ${owners.join(', ')}`)
    }
  }
  assert.equal(requestStatusGroupSql('downloaded', 'r'), `(r.status = 'available' AND lib.id IS NULL)`)
  assert.equal(requestStatusGroupSql('inLibrary', 'r'), `(r.status = 'available' AND lib.id IS NOT NULL)`)
  // Exactly the groups that read the join say so, so the count joins it when needed.
  for (const group of REQUEST_STATUS_GROUPS) {
    assert.equal(groupReadsLibrary(group), requestStatusGroupSql(group, 'r').includes('lib.'), group)
  }
})

test('the group key matches the groups', () => {
  for (const a of STORED) {
    for (const b of STORED) {
      const sameGroup = REQUEST_STATUS_GROUPS.some((g) => {
        const sql = requestStatusGroupSql(g, 'r')
        return sql.includes(`'${a}'`) && sql.includes(`'${b}'`)
      })
      assert.equal(statusGroupKey(a) === statusGroupKey(b), sameGroup, `${a} / ${b}`)
    }
  }
})

test("the library join is the viewer's scope, bound for both media types", () => {
  const params: unknown[] = []
  const sql = requestLibraryJoinSql('r', scope, binderFor(params))
  // Ids and rating bound once per table, never written into the text.
  assert.deepEqual(params, [['lib-a'], 7, ['lib-a'], 7])
  assert.match(sql, /lm\.provider_library_id = ANY\(\$1::text\[\]\)/)
  assert.match(sql, /ls\.provider_library_id = ANY\(\$3::text\[\]\)/)
  assert.match(sql, /\) lib ON true$/)
  assert.doesNotMatch(sql, /lib-a/)
  // No scope restricts nothing and binds nothing.
  const none: unknown[] = []
  assert.doesNotMatch(requestLibraryJoinSql('r', null, binderFor(none)), /provider_library_id/)
  assert.deepEqual(none, [])
})

test('every order ends on the row id, so pages never overlap', () => {
  for (const sort of REQUEST_SORTS) {
    assert.match(requestOrderSql(sort, 'r'), /r\.id (ASC|DESC)$/)
  }
})

test('the latest-change order never reads updated_at, which re-checks move', () => {
  assert.doesNotMatch(requestOrderSql('recentChange', 'r'), /updated_at/)
})

test('unknown values are not groups or sorts', () => {
  assert.equal(isRequestStatusGroup('available'), false)
  assert.equal(isRequestStatusGroup('inLibrary'), true)
  assert.equal(isRequestSort('created_at'), false)
  assert.equal(isRequestSort('oldest'), true)
  assert.equal(isRequestSort(undefined), false)
})
