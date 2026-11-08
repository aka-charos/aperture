/**
 * The title-search SQL: which tier each kind of match lands in, that the close
 * (typo) tier ranks below every literal match, and that nothing but
 * placeholders and column names ever reaches the text.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  containsPattern,
  queryKeySql,
  closeTitleSql,
  titleRelevanceSql,
  FUZZY_MIN_KEY_CHARS,
  LITERAL_MATCH_RELEVANCE,
} from './titleSearch.js'

test('a contains-pattern takes a title\'s own wildcards literally', () => {
  assert.equal(containsPattern('Heat'), '%Heat%')
  assert.equal(containsPattern('100% Wolf'), '%100\\% Wolf%')
  assert.equal(containsPattern('a_b\\c'), '%a\\_b\\\\c%')
})

test('the query is folded by the same SQL function as the stored keys', () => {
  assert.equal(queryKeySql('$2'), 'aperture_search_key($2::text)')
})

test('the close tier needs a few characters and uses the indexed operators on both titles', () => {
  const sql = closeTitleSql('K', 't')
  assert.match(sql, new RegExp(`length\\(K\\) >= ${FUZZY_MIN_KEY_CHARS}`))
  for (const op of ['K % t.title_search_key', 'K <% t.title_search_key', 'K % t.original_title_search_key', 'K <% t.original_title_search_key']) {
    assert.ok(sql.includes(op), op)
  }
})

test('tiers run exact, article-free, contained, close, then nothing — close stays below literal', () => {
  const sql = titleRelevanceSql('$1', 'K')
  const order = ['THEN 5', 'THEN 4', 'THEN 3', 'THEN 1 + GREATEST', 'ELSE 0'].map((s) => sql.indexOf(s))
  assert.ok(order.every((at) => at >= 0), 'every tier present')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'tiers in rank order')
  // word_similarity is at most 1, so the close tier tops out at 2, under the literal tiers.
  assert.equal(LITERAL_MATCH_RELEVANCE, 3)
  assert.match(sql, /regexp_replace\(K, '\^\(the\|an\|a\) ', ''\)/)
  // The contained tier reads all three names, accents aside (titleMatch.ts).
  assert.match(sql, /unaccent\(COALESCE\(sort_title, ''\)\) ILIKE unaccent\(\$1\)/)
})

test('an alias reaches every column, and the only literals are the article rule and empty defaults', () => {
  const sql = titleRelevanceSql('$7', queryKeySql('$8'), 'm')
  assert.doesNotMatch(sql, /[^.]\btitle_search_key|[^.]\boriginal_title_search_key/)
  assert.ok(sql.includes('$7') && sql.includes('$8'))
  const literals = [...sql.matchAll(/'[^']*'/g)].map((m) => m[0])
  assert.deepEqual([...new Set(literals)].sort(), ["''", "'^(the|an|a) '"])
})
