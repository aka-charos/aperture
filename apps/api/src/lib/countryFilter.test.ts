/**
 * The Browse country filter. Its failure is quiet in both directions: too wide
 * and a film where Greece is the third co-producer is listed as Greek, too
 * narrow and a selection matches nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countryFilterSql, parseCountryQuery } from './countryFilter.js'

function build(countries: string[], match?: 'all' | 'any', scope?: 'primary' | 'any') {
  const params: unknown[] = []
  const sql = countryFilterSql(countries, match, scope, (value) => {
    params.push(value)
    return `$${params.length}`
  })
  return { sql, params }
}

test('nothing selected adds no clause and binds nothing', () => {
  assert.deepEqual(build([]), { sql: null, params: [] })
})

test('primary scope matches only the first-listed country', () => {
  const { sql, params } = build(['Greece'], 'any', 'primary')
  assert.equal(sql, 'production_countries[1] = ANY($1::text[])')
  assert.deepEqual(params, [['Greece']])
})

test('primary scope with OR: the first-listed country is any of the selection', () => {
  assert.equal(build(['Greece', 'Cyprus'], 'any', 'primary').sql, 'production_countries[1] = ANY($1::text[])')
})

test('primary scope with AND: led by one of them and co-produced by all, one bound list', () => {
  const { sql, params } = build(['Greece', 'Cyprus'], 'all', 'primary')
  assert.equal(sql, '(production_countries[1] = ANY($1::text[]) AND production_countries @> $1::text[])')
  assert.equal(params.length, 1)
})

test('primary scope with AND on one country is plain primary', () => {
  assert.equal(build(['Greece'], 'all', 'primary').sql, 'production_countries[1] = ANY($1::text[])')
})

test('any scope keeps membership: OR overlaps, AND contains', () => {
  assert.equal(build(['Greece', 'Cyprus'], 'any', 'any').sql, 'production_countries && $1::text[]')
  assert.equal(build(['Greece', 'Cyprus'], 'all', 'any').sql, 'production_countries @> $1::text[]')
})

test('absent parameters keep the behaviour API callers always had: anywhere in the list, AND', () => {
  assert.equal(build(['Greece', 'Cyprus']).sql, 'production_countries @> $1::text[]')
})

test('the query parser splits, trims and dedupes', () => {
  assert.deepEqual(parseCountryQuery('Greece, Cyprus,,Greece'), ['Greece', 'Cyprus'])
  assert.deepEqual(parseCountryQuery(['Greece', ' Greece ']), ['Greece'])
  assert.deepEqual(parseCountryQuery(undefined), [])
})
