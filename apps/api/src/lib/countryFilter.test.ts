/**
 * The Browse country filter. Its failure is quiet in both directions: too wide
 * and a film where Greece is the third of four co-producers is listed as Greek,
 * too narrow and a selection matches nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_COUNTRIES_SQL,
  PRIMARY_COUNTRIES_SQL,
  countryFilterSql,
  parseCountryQuery,
} from './countryFilter.js'

function build(countries: string[], match?: 'all' | 'any', scope?: 'primary' | 'any') {
  const params: unknown[] = []
  const sql = countryFilterSql(countries, match, scope, params)
  return { sql, params }
}

test('the placeholder follows the parameters already bound, with its $', () => {
  const params: unknown[] = ['scope-a', 'scope-b', 'search']
  const sql = countryFilterSql(['Italy'], 'any', 'primary', params)
  assert.equal(sql, `(${PRIMARY_COUNTRIES_SQL}) && $4::text[]`)
  assert.deepEqual(params[3], ['Italy'])
  assert.equal(params.length, 4)
})

const PRIMARY = `(${PRIMARY_COUNTRIES_SQL}) && $1::text[]`

test('nothing selected adds no clause and binds nothing', () => {
  assert.deepEqual(build([]), { sql: null, params: [] })
})

test('primary reads the TMDb origin when known and falls back to the first production country', () => {
  assert.match(PRIMARY_COUNTRIES_SQL, /cardinality\(origin_countries\) > 0 THEN origin_countries/)
  assert.match(PRIMARY_COUNTRIES_SQL, /ELSE production_countries\[1:1\]/)
})

test('primary scope with one country, or with OR, is the overlap with the primary set', () => {
  const one = build(['Greece'], 'any', 'primary')
  assert.equal(one.sql, PRIMARY)
  assert.deepEqual(one.params, [['Greece']])
  assert.equal(build(['Greece', 'Cyprus'], 'any', 'primary').sql, PRIMARY)
  assert.equal(build(['Greece'], 'all', 'primary').sql, PRIMARY)
})

test('primary scope with AND: from one of them and associated with all, one bound list', () => {
  const { sql, params } = build(['Greece', 'Cyprus'], 'all', 'primary')
  assert.equal(sql, `((${PRIMARY}) AND ${ALL_COUNTRIES_SQL} @> $1::text[])`)
  assert.equal(params.length, 1)
})

test('any scope is membership in co-producers PLUS origin, so it is a superset of primary', () => {
  assert.equal(build(['Greece', 'Cyprus'], 'any', 'any').sql, `${ALL_COUNTRIES_SQL} && $1::text[]`)
  assert.equal(build(['Greece', 'Cyprus'], 'all', 'any').sql, `${ALL_COUNTRIES_SQL} @> $1::text[]`)
  assert.match(ALL_COUNTRIES_SQL, /production_countries \|\| COALESCE\(origin_countries/)
})

test('absent parameters keep the behaviour API callers always had: anywhere, AND', () => {
  assert.equal(build(['Greece', 'Cyprus']).sql, `${ALL_COUNTRIES_SQL} @> $1::text[]`)
})

test('the query parser splits, trims and dedupes', () => {
  assert.deepEqual(parseCountryQuery('Greece, Cyprus,,Greece'), ['Greece', 'Cyprus'])
  assert.deepEqual(parseCountryQuery(['Greece', ' Greece ']), ['Greece'])
  assert.deepEqual(parseCountryQuery(undefined), [])
})
