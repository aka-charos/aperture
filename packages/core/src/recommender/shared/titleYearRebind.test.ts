import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  externalIdsConflict,
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
