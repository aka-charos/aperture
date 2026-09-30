import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  externalIdsConflict,
  indexByTitleYear,
  pickTitleYearRow,
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
