/**
 * Pins the people and franchise searches behind the palette: the query text is
 * always a bound parameter, both sides are folded by the one search-key
 * function, and the viewer's scope reaches every table read.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  NAME_SEARCH_MAX_LIMIT,
  buildFranchiseSearch,
  buildPeopleSearch,
  clampNameLimit,
  nameMatchRankSql,
} from './nameSearch.js'

/** A scope binder that records which aliases it was asked for. */
function recordingScope() {
  const aliases: string[] = []
  const bind = (alias: string, params: unknown[]) => {
    aliases.push(alias)
    params.push(`scope-${alias}`)
    return `${alias}.in_scope = $${params.length}`
  }
  return { aliases, bind }
}

test('the query is a bound parameter, never interpolated', () => {
  const hostile = "x'; DROP TABLE users; --"
  for (const build of [buildPeopleSearch, buildFranchiseSearch]) {
    const { sql, params } = build(hostile, 4, recordingScope().bind)
    assert.equal(params[0], hostile)
    assert.ok(!sql.includes('DROP TABLE'))
    assert.match(sql, /aperture_search_key\(\$1\)/)
  }
})

test('people are scoped on all four credit reads, films and shows', () => {
  const { aliases, bind } = recordingScope()
  const { sql, params } = buildPeopleSearch('nolan', 4, bind)
  assert.deepEqual(aliases, ['m', 's'])
  // Each clause is used twice (actors and directors) for its table.
  assert.equal(sql.match(/\(m\.in_scope = \$3\)/g)?.length, 2)
  assert.equal(sql.match(/\(s\.in_scope = \$4\)/g)?.length, 2)
  assert.deepEqual(params, ['nolan', 4, 'scope-m', 'scope-s'])
})

test('franchises are scoped, and only ones with an id are offered', () => {
  const { aliases, bind } = recordingScope()
  const { sql } = buildFranchiseSearch('star wars', 3, bind)
  assert.deepEqual(aliases, ['m'])
  assert.match(sql, /\(m\.in_scope = \$3\)/)
  assert.match(sql, /m\.collection_id IS NOT NULL/)
})

test('a name matches at the start of a word, not anywhere inside one', () => {
  const rank = nameMatchRankSql('n', 'k')
  assert.match(rank, /WHEN n = k THEN 0/)
  assert.match(rank, /WHEN n LIKE k \|\| '%' THEN 1/)
  assert.match(rank, /WHEN n LIKE '% ' \|\| k \|\| '%' THEN 2/)
  assert.ok(!/LIKE '%' \|\| k/.test(rank), 'an infix match would find "ark" in "Clark"')
})

test('limits fall back on garbage and stay inside the ceiling', () => {
  assert.equal(clampNameLimit(undefined, 4), 4)
  assert.equal(clampNameLimit('abc', 3), 3)
  assert.equal(clampNameLimit('-2', 4), 0)
  assert.equal(clampNameLimit('999', 4), NAME_SEARCH_MAX_LIMIT)
  assert.equal(clampNameLimit('0', 4), 0)
})
