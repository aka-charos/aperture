import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addToRebindIndex,
  buildRebindIndex,
  decideIncoming,
  externalIdsConflict,
  findRebindRow,
  titlesRelated,
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
  {
    providerItemId: '582326',
    title: 'Mallrats',
    year: 1995,
    tmdbId: '2293',
    imdbId: 'tt0113749',
    titles: ['Mallrats', null],
  },
  {
    providerItemId: '582323',
    title: 'Clerks (Extended)',
    year: 1994,
    tmdbId: '2292',
    imdbId: 'tt0109445',
    titles: ['Clerks (Extended)', 'Clerks'],
  },
]
const FALLBACK = { byExternalId: true }

test('a re-added item with no year takes over its old row by external id', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set(['1184006'])
  const match = findRebindRow(
    index,
    { providerItemId: '1184006', title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    (id) => live.has(id),
    FALLBACK
  )
  assert.equal(match?.row.title, 'Mallrats')
  assert.equal(match?.previousId, '582326')
  assert.equal(match?.row.providerItemId, '1184006')
})

test('a renamed re-added item takes over its old row: one id and a related name', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const match = findRebindRow(
    index,
    { providerItemId: '1184001', title: 'Clerks', year: 1994, tmdbId: '2292', imdbId: null },
    (id) => id === '1184001',
    FALLBACK
  )
  assert.equal(match?.row.title, 'Clerks (Extended)')
})

test('one agreeing id with an unrelated name is a mis-identified item, not a re-issue', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const match = findRebindRow(
    index,
    { providerItemId: 'x', title: 'Dogma', year: null, tmdbId: '2293', imdbId: null },
    () => false,
    FALLBACK
  )
  assert.equal(match, null)
})

test('two agreeing ids carry a takeover across a translated name', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const match = findRebindRow(
    index,
    { providerItemId: 'gr', title: 'Τα Μαγαζάκια', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    () => false,
    FALLBACK
  )
  assert.equal(match?.previousId, '582326')
})

test('one agreeing id and no stored name to compare is refused', () => {
  const index = buildRebindIndex([
    { providerItemId: 'old', title: 'Mallrats', year: 1995, tmdbId: '2293', imdbId: null },
  ])
  const match = findRebindRow(
    index,
    { providerItemId: 'new', title: 'Mallrats', year: null, tmdbId: '2293' },
    () => false,
    FALLBACK
  )
  assert.equal(match, null)
})

test('without the fallback allowed, an id match is never taken', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const match = findRebindRow(
    index,
    { providerItemId: '1184006', title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    () => false,
    { byExternalId: false }
  )
  assert.equal(match, null)
})

test('a row whose item is still on the server is never taken by external id', () => {
  // The same film in two libraries under two names: both items are live.
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set(['582326', '999'])
  const match = findRebindRow(
    index,
    { providerItemId: '999', title: "Mallrats (Director's Cut)", year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    (id) => live.has(id),
    FALLBACK
  )
  assert.equal(match, null)
})

test('an external-id match needs no conflicting id', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const gone = () => false
  // IMDb agrees, TMDb disagrees: two works mislabelled, not one re-issued.
  assert.equal(
    findRebindRow(
      index,
      { providerItemId: 'a', title: 'Mallrats', year: null, tmdbId: '1', imdbId: 'tt0113749' },
      gone,
      FALLBACK
    ),
    null
  )
  // No ids at all: nothing to match on.
  assert.equal(findRebindRow(index, { providerItemId: 'b', title: 'Mallrats', year: null }, gone, FALLBACK), null)
})

test('id spaces do not collide: a TVDb id equal to a TMDb id is no match', () => {
  const index = buildRebindIndex([
    { providerItemId: 'old', title: 'Show', year: 2001, tmdbId: '1832', imdbId: null, tvdbId: null, titles: ['Show'] },
  ])
  assert.equal(
    findRebindRow(index, { providerItemId: 'new', title: 'Show', year: null, tvdbId: '1832' }, () => false, FALLBACK),
    null
  )
})

test('a row is taken over once: a second item with the same ids gets its own row', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const live = new Set<string>()
  const take = (id: string) => {
    live.add(id)
    return findRebindRow(
      index,
      { providerItemId: id, title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
      (x) => live.has(x),
      FALLBACK
    )
  }
  assert.equal(take('n1')?.row.providerItemId, 'n1')
  assert.equal(take('n2'), null)
})

test('two gone rows tied for one item: the first, the oldest the sync read, wins', () => {
  const rows = [
    { providerItemId: 'oldest', title: 'Mallrats', year: 1995, tmdbId: '2293', imdbId: 'tt0113749', titles: ['Mallrats'] },
    { providerItemId: 'newer', title: 'Mallrats', year: 1995, tmdbId: '2293', imdbId: 'tt0113749', titles: ['Mallrats'] },
  ]
  const match = findRebindRow(
    buildRebindIndex(rows),
    { providerItemId: 'n', title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' },
    (id) => id === 'n',
    FALLBACK
  )
  assert.equal(match?.previousId, 'oldest')
})

test('a row inserted this run can be matched later by title and year, as before', () => {
  const index = buildRebindIndex<{ providerItemId: string; tmdbId?: string | null }>([])
  addToRebindIndex(index, { providerItemId: 'hd', tmdbId: '2293' }, 'Mallrats', 1995)
  const match = findRebindRow(
    index,
    { providerItemId: '4k', title: 'Mallrats', year: 1995, tmdbId: '2293' },
    (id) => id === 'hd' || id === '4k',
    { byExternalId: false }
  )
  assert.equal(match?.previousId, 'hd')
})

// ---- the two phases both syncs run ----

test('while libraries are listed, an item only an external id would place is deferred', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const incoming = { providerItemId: '1184006', title: 'Mallrats', year: null, tmdbId: '2293', imdbId: 'tt0113749' }
  // Listing phase: the old row's item may sit in a library not listed yet.
  assert.deepEqual(decideIncoming(index, new Set(), incoming, () => false, 'listing'), { kind: 'defer' })
  // The deferral touched nothing.
  assert.equal(index.byExternalId.get('tmdb:2293')?.[0].providerItemId, '582326')
  // Final phase, liveness complete: it takes the row over.
  const final = decideIncoming(index, new Set(), incoming, (id) => id === '1184006', 'final')
  assert.equal(final.kind, 'takeover')
})

test('a known provider id is an update, and an unclaimed item in the final phase is an insert', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const known = { providerItemId: '582326', title: 'Mallrats', year: 1995, tmdbId: '2293' }
  assert.deepEqual(decideIncoming(index, new Set(['582326']), known, () => true, 'listing'), { kind: 'update' })
  const stranger = { providerItemId: 'z', title: 'Jersey Girl', year: 2004, tmdbId: '9999' }
  assert.deepEqual(decideIncoming(index, new Set(), stranger, () => false, 'final'), { kind: 'insert' })
})

test('a title+year match is taken while listing, as it always was', () => {
  const index = buildRebindIndex(kevinSmithRows())
  const decision = decideIncoming(
    index,
    new Set(),
    { providerItemId: 'n', title: 'Mallrats', year: 1995, tmdbId: '2293' },
    (id) => id === 'n',
    'listing'
  )
  assert.equal(decision.kind, 'takeover')
})

test('related names fold accents, case and punctuation, and an empty fold relates to nothing', () => {
  assert.equal(titlesRelated(['Clerks (Extended)'], ['clerks']), true)
  assert.equal(titlesRelated(['Amélie'], ['AMELIE!']), true)
  assert.equal(titlesRelated(['Dogma'], ['Mallrats']), false)
  assert.equal(titlesRelated(['!!!'], ['!!!']), false)
  assert.equal(titlesRelated(undefined, ['Mallrats']), false)
})
