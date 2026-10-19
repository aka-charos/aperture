import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addToRebindIndex,
  buildRebindIndex,
  externalIdsConflict,
  findRebindRow,
  indexByTitleYear,
  pickTitleYearRow,
  takeOverRow,
  titleYearKey,
} from './titleYearRebind.js'

test('two different films sharing title and year keep separate rows', () => {
  // Swan Song (2021): Mahershala Ali, and Udo Kier. Same key, different works.
  const index = indexByTitleYear([
    { providerItemId: 'emby-ali', title: 'Swan Song', year: 2021, tmdbId: '514847', imdbId: 'tt13207736' },
  ])
  const kier = { tmdbId: '785539', imdbId: 'tt11702660' }
  assert.equal(pickTitleYearRow(index.get(titleYearKey('Swan Song', 2021)!), kier), null)
})

test('a re-issued provider id takes over its own row', () => {
  const rows = [{ providerItemId: 'old', tmdbId: '514847', imdbId: 'tt13207736' }]
  assert.equal(pickTitleYearRow(rows, { tmdbId: '514847', imdbId: 'tt13207736' })?.providerItemId, 'old')
})

test('a re-issue finds its own row beside a same-titled different work', () => {
  const rows = [
    { providerItemId: 'kier', tmdbId: '785539' },
    { providerItemId: 'ali', tmdbId: '514847' },
  ]
  assert.equal(pickTitleYearRow(rows, { tmdbId: '514847' })?.providerItemId, 'ali')
})

test('with no comparable id the fallback keeps its old behaviour', () => {
  const rows = [{ providerItemId: 'old', tmdbId: null, imdbId: null }]
  assert.equal(pickTitleYearRow(rows, {})?.providerItemId, 'old')
  assert.equal(pickTitleYearRow(rows, { tmdbId: '1' })?.providerItemId, 'old')
})

test('a row whose own id is still on the server is not taken by an id-less work', () => {
  // One of the pair was never identified (no external ids): nothing conflicts,
  // so only liveness can tell a re-issue from a second work.
  const rows = [{ providerItemId: 'identified', tmdbId: '514847' }]
  const live = (id: string) => id === 'identified'
  assert.equal(pickTitleYearRow(rows, {}, live), null)
  // Same row, its id gone from the server: a genuine re-issue.
  assert.equal(pickTitleYearRow(rows, {}, () => false)?.providerItemId, 'identified')
})

test('a live row is still shared by the same work held twice', () => {
  // 4K and HD copies of one film: ids agree, so they keep one row as before.
  const rows = [{ providerItemId: 'hd', tmdbId: '514847' }]
  assert.equal(pickTitleYearRow(rows, { tmdbId: '514847' }, () => true)?.providerItemId, 'hd')
})

test('a takeover replaces the ids, so the old owner cannot reclaim a live row', () => {
  const row = { providerItemId: 'old', tmdbId: '514847', imdbId: 'tt13207736' }
  // An unidentified item takes the row over (its old id is gone)...
  takeOverRow(row, 'unidentified', {})
  assert.deepEqual(row, { providerItemId: 'unidentified', tmdbId: null, imdbId: null, tvdbId: null })
  // ...so a later item carrying the old owner's ids has nothing to agree with,
  // and the row's owner is live: it gets its own row.
  const live = (id: string) => id === 'unidentified'
  assert.equal(pickTitleYearRow([row], { tmdbId: '514847' }, live), null)
})

test('any disagreeing id is a conflict; case and whitespace are not', () => {
  assert.equal(externalIdsConflict({ imdbId: 'TT1 ' }, { imdbId: 'tt1' }), false)
  assert.equal(externalIdsConflict({ tmdbId: 1 }, { tmdbId: '1' }), false)
  assert.equal(externalIdsConflict({ tmdbId: '1', tvdbId: '5' }, { tmdbId: '1', tvdbId: '6' }), true)
  assert.equal(externalIdsConflict({ tmdbId: '' }, { tmdbId: '2' }), false)
})

test('no key without a title or a year', () => {
  assert.equal(titleYearKey('Swan Song', null), null)
  assert.equal(titleYearKey(undefined, 2021), null)
  assert.equal(titleYearKey('Swan Song', 2021), 'swan song|2021')
  assert.equal(indexByTitleYear([{ providerItemId: 'x', title: 'A', year: null }]).size, 0)
})

// ---- the external-id fallback ----

// Measured: Emby rescanned a folder, deleted twelve films and re-added them
// under new ids, with no year yet and one renamed. Title+year had nothing to
// match; the TMDb and IMDb ids were the same on both sides.
const kevinSmithRows = () => [
  { providerItemId: '582326', title: 'Mallrats', year: 1995, tmdbId: '2293', imdbId: 'tt0113749' },
  { providerItemId: '582323', title: 'Clerks (Extended)', year: 1994, tmdbId: '2292', imdbId: 'tt0109445' },
]

test('a re-added item with no year takes over its old row by external id', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set(['1184006'])
  const match = findRebindRow(
    index,
    { providerItemId: '1184006', title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    (id) => live.has(id)
  )
  assert.equal(match?.row.title, 'Mallrats')
  assert.equal(match?.previousId, '582326')
  assert.equal(match?.row.providerItemId, '1184006')
})

test('a renamed re-added item takes over its old row by external id', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const match = findRebindRow(
    index,
    { providerItemId: '1184001', title: 'Clerks', year: 1994, tmdbId: '2292', imdbId: null },
    (id) => id === '1184001'
  )
  assert.equal(match?.row.title, 'Clerks (Extended)')
})

test('a row whose item is still on the server is never taken by external id alone', () => {
  // The same film in two libraries under two names: both items are live, and
  // nothing about the name vouches for a merge.
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set(['582326', '999'])
  const match = findRebindRow(
    index,
    { providerItemId: '999', title: "Mallrats (Director's Cut)", year: null, tmdbId: '2293' },
    (id) => live.has(id)
  )
  assert.equal(match, null)
})

test('an external-id match needs an agreeing id and no conflicting one', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const gone = () => false
  // IMDb agrees, TMDb disagrees: two works mislabelled, not one re-issued.
  assert.equal(
    findRebindRow(index, { providerItemId: 'a', title: 'X', year: null, tmdbId: '1', imdbId: 'tt0113749' }, gone),
    null
  )
  // No ids at all: nothing to match on.
  assert.equal(findRebindRow(index, { providerItemId: 'b', title: 'X', year: null }, gone), null)
})

test('id spaces do not collide: a TVDb id equal to a TMDb id is no match', () => {
  const index = buildRebindIndex([
    { providerItemId: 'old', title: 'Show', year: 2001, tmdbId: '1832', imdbId: null, tvdbId: null },
  ])
  assert.equal(
    findRebindRow(index, { providerItemId: 'new', title: 'Other', year: null, tvdbId: '1832' }, () => false),
    null
  )
})

test('a row is taken over once: a second item with the same ids gets its own row', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set<string>()
  const take = (id: string) => {
    live.add(id)
    return findRebindRow(index, { providerItemId: id, title: 'Mallrats', year: null, tmdbId: '2293' }, (x) =>
      live.has(x)
    )
  }
  assert.equal(take('n1')?.row.providerItemId, 'n1')
  assert.equal(take('n2'), null)
})

test('a row inserted this run can be matched later by title and year, as before', () => {
  const index = buildRebindIndex<{ providerItemId: string; tmdbId?: string | null }>([])
  addToRebindIndex(index, { providerItemId: 'hd', tmdbId: '2293' }, 'Mallrats', 1995)
  const match = findRebindRow(
    index,
    { providerItemId: '4k', title: 'Mallrats', year: 1995, tmdbId: '2293' },
    (id) => id === 'hd' || id === '4k'
  )
  assert.equal(match?.previousId, 'hd')
})
