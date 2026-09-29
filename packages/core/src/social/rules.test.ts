import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displayNameSql,
  groupInbox,
  isUuid,
  recipientSkipReason,
  sentStatus,
  validatePair,
  visibleConnectionsSql,
} from './rules.js'

const A = '0b6f9f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const B = 'f1e2d3c4-b5a6-4978-8a9b-cdef01234567'

test('validatePair lowercases both ends and keeps their order', () => {
  // Ordering is the database's job (LEAST/GREATEST). A string comparison here
  // would disagree with uuid ordering on mixed-case input and 500 on the CHECK.
  assert.deepEqual(validatePair(B.toUpperCase(), A), [B, A])
  assert.deepEqual(validatePair(A, B.toUpperCase()), [A, B])
})

test('validatePair refuses malformed ids', () => {
  assert.throws(() => validatePair('not-a-uuid', A), RangeError)
  assert.throws(() => validatePair(A, ''), RangeError)
  assert.throws(() => validatePair(`${A} `, B), RangeError)
  assert.throws(() => validatePair(A, `${B}; DROP TABLE users`), RangeError)
})

test('validatePair refuses a self-pair in any letter case', () => {
  assert.throws(() => validatePair(A, A), RangeError)
  assert.throws(() => validatePair(A, A.toUpperCase()), RangeError)
  assert.throws(() => validatePair(B.toUpperCase(), B), RangeError)
})

test('isUuid accepts either case and nothing else', () => {
  assert.equal(isUuid(A), true)
  assert.equal(isUuid(A.toUpperCase()), true)
  assert.equal(isUuid('123'), false)
})

test('recipientSkipReason: not_connected > unavailable > already_watched > send', () => {
  const cases: Array<[boolean, boolean, boolean, string | null]> = [
    // connected, inScope, finished, expected
    [false, false, false, 'not_connected'],
    [false, false, true, 'not_connected'],
    [false, true, false, 'not_connected'],
    [false, true, true, 'not_connected'],
    [true, false, false, 'unavailable'],
    // Out of scope wins over watched: a title they cannot open says nothing
    // about their history.
    [true, false, true, 'unavailable'],
    [true, true, true, 'already_watched'],
    [true, true, false, null],
  ]
  for (const [connected, inScope, finished, expected] of cases) {
    assert.equal(
      recipientSkipReason({ connected, inScope, finished }),
      expected,
      `connected=${connected} inScope=${inScope} finished=${finished}`
    )
  }
})

test('sentStatus: unavailable > watched > watching > waiting', () => {
  const cases: Array<[boolean, boolean, number, string]> = [
    // inScope, finished, episodesWatched, expected
    // Out of scope wins over watched, as in recipientSkipReason.
    [false, true, 10, 'unavailable'],
    [false, false, 0, 'unavailable'],
    [true, true, 10, 'watched'],
    [true, true, 0, 'watched'],
    [true, false, 3, 'watching'],
    [true, false, 0, 'waiting'],
  ]
  for (const [inScope, finished, episodesWatched, expected] of cases) {
    assert.equal(
      sentStatus({ inScope, finished, episodesWatched }),
      expected,
      `inScope=${inScope} finished=${finished} episodesWatched=${episodesWatched}`
    )
  }
})

test('groupInbox groups per recommender, ordered by name, items in row order', () => {
  const rows = [
    { id: '1', recommenderId: 'u-tom', recommenderName: 'Tom' },
    { id: '2', recommenderId: 'u-anna', recommenderName: 'anna' },
    { id: '3', recommenderId: 'u-tom', recommenderName: 'Tom' },
    { id: '4', recommenderId: 'u-joe', recommenderName: 'Joe' },
    { id: '5', recommenderId: 'u-anna', recommenderName: 'anna' },
  ]
  const groups = groupInbox(rows)
  assert.deepEqual(
    groups.map((g) => g.recommenderName),
    ['anna', 'Joe', 'Tom'],
    'case-insensitive name order'
  )
  assert.deepEqual(groups[0].items.map((r) => r.id), ['2', '5'])
  assert.deepEqual(groups[2].items.map((r) => r.id), ['1', '3'])
})

test('groupInbox keeps two people with the same name apart', () => {
  const groups = groupInbox([
    { recommenderId: 'b', recommenderName: 'Sam' },
    { recommenderId: 'a', recommenderName: 'Sam' },
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((g) => g.recommenderId), ['a', 'b'])
})

test('groupInbox on nothing is nothing', () => {
  assert.deepEqual(groupInbox([]), [])
})

test('a visible connection has access here AND on the media server', () => {
  // A string check, but it guards the one rule a tidy-up would silently drop:
  // without either half, a person who lost access keeps being named, keeps
  // their history readable and keeps their recommendations in the inbox.
  const sql = visibleConnectionsSql('$1::uuid')
  assert.match(sql, /cu\.is_enabled = true/)
  assert.match(sql, /cu\.provider_disabled = false/)
  assert.match(sql, /\$1::uuid/)
})

test('displayNameSql falls back to the username on a blank display name', () => {
  const sql = displayNameSql('u')
  assert.match(sql, /NULLIF\(TRIM\(COALESCE\(u\.display_name, ''\)\), ''\)/)
  assert.match(sql, /u\.username\)$/)
})
