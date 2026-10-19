/**
 * What a viewer may be shown. Both ways this goes wrong are quiet: too wide, and
 * someone the media server keeps out of a library is recommended — and can play —
 * its titles; too narrow, and a feature looks broken for a person who is merely
 * allowed fewer libraries than the admin testing it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  binderFor,
  libraryIdsFromFolderAccess,
  libraryScopeSql,
  resolveLibraryScope,
  scopeHas,
  scopedAnnSettings,
  SCOPED_ANN_EF_SEARCH,
  type ConfiguredLibrary,
} from './libraryScope.js'

const MOVIES: ConfiguredLibrary = { id: 'm1', collectionType: 'movies', isEnabled: true }
const KIDS: ConfiguredLibrary = { id: 'm2', collectionType: 'movies', isEnabled: true }
const SHOWS: ConfiguredLibrary = { id: 's1', collectionType: 'tvshows', isEnabled: true }
const OFF: ConfiguredLibrary = { id: 'm3', collectionType: 'movies', isEnabled: false }
const ALL = [MOVIES, KIDS, SHOWS, OFF]

test('an account the server lets see everything sees every enabled library', () => {
  const scope = resolveLibraryScope({ libraries: ALL, userLibraryIds: null, maxParentalRating: null })
  assert.deepEqual(scope.libraryIds, ['m1', 'm2', 's1'])
  assert.equal(scope.hasMovies, true)
  assert.equal(scope.hasSeries, true)
})

test('the server permission narrows what the operator enabled', () => {
  const scope = resolveLibraryScope({ libraries: ALL, userLibraryIds: ['m2', 's1'], maxParentalRating: null })
  assert.deepEqual(scope.libraryIds, ['m2', 's1'])
})

test('the operator switch narrows what the server allows, and never widens it', () => {
  // m3 is allowed by the server but switched off here; m1 is enabled here but
  // not allowed by the server.
  const scope = resolveLibraryScope({ libraries: ALL, userLibraryIds: ['m3', 's1'], maxParentalRating: null })
  assert.deepEqual(scope.libraryIds, ['s1'])
})

test('media types follow from the libraries in scope', () => {
  const seriesOnly = resolveLibraryScope({ libraries: ALL, userLibraryIds: ['s1'], maxParentalRating: null })
  assert.equal(scopeHas(seriesOnly, 'movies'), false)
  assert.equal(scopeHas(seriesOnly, 'series'), true)

  // A movie library the operator switched off does not count as having movies.
  const offOnly = resolveLibraryScope({ libraries: ALL, userLibraryIds: ['m3'], maxParentalRating: null })
  assert.equal(offOnly.hasMovies, false)
  assert.deepEqual(offOnly.libraryIds, [])
})

test('an empty permission is a real answer: nothing, not everything', () => {
  // `[]` and `null` must never be confused — `[]` is an account granted no
  // library, `null` one granted all of them.
  const scope = resolveLibraryScope({ libraries: ALL, userLibraryIds: [], maxParentalRating: null })
  assert.deepEqual(scope.libraryIds, [])
  assert.equal(scope.hasMovies, false)
  assert.equal(scope.hasSeries, false)
})

test('with nothing configured only the server permission applies', () => {
  const open = resolveLibraryScope({ libraries: [], userLibraryIds: null, maxParentalRating: null })
  assert.equal(open.libraryIds, null)
  assert.equal(open.hasMovies, true)

  const narrowed = resolveLibraryScope({ libraries: [], userLibraryIds: ['x'], maxParentalRating: 7 })
  assert.deepEqual(narrowed.libraryIds, ['x'])
  assert.equal(narrowed.maxParentalRating, 7)
})

test('folder access maps GUIDs to the library ids titles carry', () => {
  const libraries = [
    { id: 'item-1', guid: 'AAAA-1111' },
    { id: 'item-2', guid: 'bbbb-2222' },
  ]
  assert.equal(libraryIdsFromFolderAccess({ enableAllFolders: true, enabledFolders: [] }, libraries), null)
  // Case and dashes ignored, and one GUID this instance has never seen is dropped.
  assert.deepEqual(
    libraryIdsFromFolderAccess({ enableAllFolders: false, enabledFolders: ['aaaa1111', 'unknown'] }, libraries),
    ['item-1']
  )
  // Jellyfin can name a library by its item id.
  assert.deepEqual(
    libraryIdsFromFolderAccess({ enableAllFolders: false, enabledFolders: ['item-2'] }, libraries),
    ['item-2']
  )
  assert.deepEqual(libraryIdsFromFolderAccess({ enableAllFolders: false, enabledFolders: [] }, libraries), [])
})

test('a library listed without an id never throws and never matches', () => {
  // Jellyfin's listing names the field ItemId; the mapper reads Id.
  const libraries = [
    { id: undefined as unknown as string, guid: undefined as unknown as string },
    { id: 'item-1', guid: 'aaaa-1111' },
  ]
  assert.deepEqual(
    libraryIdsFromFolderAccess({ enableAllFolders: false, enabledFolders: ['aaaa-1111'] }, libraries),
    ['item-1']
  )
})

test('a permission naming only folders nobody recognises is untranslatable, never "none"', () => {
  // Saving [] would hide every library from the account and let the STRM sweep
  // delete its generated libraries; undefined tells the caller to keep what it had.
  const libraries = [{ id: 'item-1', guid: 'aaaa-1111' }]
  assert.equal(
    libraryIdsFromFolderAccess({ enableAllFolders: false, enabledFolders: ['zzzz', 'yyyy'] }, libraries),
    undefined
  )
})

test('the SQL binds the scope rather than inlining it, and one shape covers every scope', () => {
  const params: unknown[] = ['already-there']
  const sql = libraryScopeSql(
    { libraryIds: ['m1'], maxParentalRating: 5, hasMovies: true, hasSeries: false },
    'm',
    binderFor(params)
  )
  assert.deepEqual(params, ['already-there', ['m1'], 5])
  assert.match(sql, /\$2::text\[\] IS NULL OR m\.provider_library_id = ANY\(\$2::text\[\]\)/)
  assert.match(sql, /\$3::int IS NULL OR m\.content_rating IS NULL/)
  assert.doesNotMatch(sql, /m1/, 'a library id is a value, never SQL text')

  const open: unknown[] = []
  libraryScopeSql({ libraryIds: null, maxParentalRating: null, hasMovies: true, hasSeries: true }, 's', binderFor(open))
  assert.deepEqual(open, [null, null])
})

test('a scoped nearest-neighbour query uses an iterative scan from pgvector 0.8', () => {
  // At ef_search 500 the planner abandons the index for a full scan plus sort
  // (1.46 s against 1.2 ms on a live library), so it is only the fallback.
  for (const version of ['0.8.0', '0.8.1', '0.10.2', '1.0.0']) {
    assert.deepEqual(scopedAnnSettings(version), ['SET LOCAL hnsw.iterative_scan = strict_order'], version)
  }
})

test('an older or unknown pgvector keeps the wide walk, never an inert iterative setting', () => {
  // An unknown dotted option is accepted silently and does nothing, which would
  // bring the restricted viewer's short list back.
  const wide = [`SET LOCAL hnsw.ef_search = ${SCOPED_ANN_EF_SEARCH}`]
  for (const version of ['0.7.4', '0.5.1', 'garbage', '', null]) {
    assert.deepEqual(scopedAnnSettings(version), wide, String(version))
  }
})
