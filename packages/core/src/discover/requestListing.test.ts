import test from 'node:test'
import assert from 'node:assert/strict'
import { binderFor, type LibraryScope } from '../lib/libraryScope.js'
import {
  REQUEST_SORTS,
  REQUEST_STATUS_GROUPS,
  groupReadsLibrary,
  isRequestSort,
  pageNeedsReread,
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

test('a title in several libraries resolves to the same copy every time', () => {
  const sql = requestLibraryJoinSql('r', null, binderFor([]))
  assert.match(sql, /ORDER BY lm\.created_at, lm\.id LIMIT 1\)/)
  assert.match(sql, /ORDER BY ls\.created_at, ls\.id LIMIT 1\)/)
})

test('a page is read again only when a recorded move can change it', () => {
  const approve = { from: 'submitted', to: 'approved' }
  const settle = { from: 'pending', to: 'submitted' }
  // A restore that put the old date back still moved the row in that order.
  const restore = { from: 'failed', to: 'approved' }
  // No filter, default order: nothing a move can change.
  assert.equal(pageNeedsReread([approve], {}), false)
  // A move out of the filter's group.
  assert.equal(pageNeedsReread([approve], { statusGroup: 'waiting' }), true)
  // A move within it (both "waiting").
  assert.equal(pageNeedsReread([settle], { statusGroup: 'waiting' }), false)
  // An exact status filter is left by any move.
  assert.equal(pageNeedsReread([settle], { status: 'pending' }), true)
  // Latest-change order moves with every status move, whoever recorded it.
  assert.equal(pageNeedsReread([settle], { sort: 'recentChange' }), true)
  assert.equal(pageNeedsReread([restore], { sort: 'recentChange' }), true)
  assert.equal(pageNeedsReread([restore], { sort: 'newest' }), false)
  // A move that records the same status is no move.
  assert.equal(pageNeedsReread([{ from: 'approved', to: 'approved' }], { status: 'approved' }), false)
})
