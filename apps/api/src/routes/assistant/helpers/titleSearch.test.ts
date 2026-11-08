/**
 * The title-search SQL and its decisions: which tier each kind of match lands
 * in, that the close (typo) pass is separate from the literal one and holds a
 * strict bar, and which media type a detail lookup answers with. Nothing but
 * placeholders and column names reaches the SQL text.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  containsPattern,
  queryKeySql,
  closeTitleSql,
  literalTitleSql,
  titleRelevanceSql,
  foundByTitle,
  pickTitleMatch,
  FUZZY_MIN_KEY_CHARS,
  CLOSE_MATCH_MIN,
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

test('the close pass compares whole words, on both titles, with a stated floor', () => {
  const sql = closeTitleSql('K', 't')
  assert.match(sql, new RegExp(`length\\(K\\) >= ${FUZZY_MIN_KEY_CHARS}`))
  for (const col of ['t.title_search_key', 't.original_title_search_key']) {
    // The indexed operator, and the floor that does not move with pg_trgm's setting.
    assert.ok(sql.includes(`K <<% ${col}`), col)
    assert.ok(sql.includes(`strict_word_similarity(K, ${col}) >= ${CLOSE_MATCH_MIN}`), col)
  }
  // Whole-string and loose word similarity let "Dune" reach "Dunkirk".
  assert.doesNotMatch(sql, / % | <% /)
  assert.equal(CLOSE_MATCH_MIN, 0.5)
})

test('the literal pass never matches by closeness', () => {
  const sql = literalTitleSql('$1', 'K')
  assert.doesNotMatch(sql, /<<%|similarity/)
  assert.match(sql, /unaccent\(title\) ILIKE unaccent\(\$1\)/)
  assert.match(sql, /regexp_replace\(K, '\^\(the\|an\|a\) ', ''\) = regexp_replace\(title_search_key/)
})

test('tiers run exact, article-free, contained, close, then nothing — close stays below literal', () => {
  const sql = titleRelevanceSql('$1', 'K')
  const order = ['THEN 5', 'THEN 4', 'THEN 3', 'THEN 1 + GREATEST', 'ELSE 0'].map((s) => sql.indexOf(s))
  assert.ok(order.every((at) => at >= 0), 'every tier present')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'tiers in rank order')
  // Strict word similarity is at most 1, so the close tier tops out at 2.
  assert.equal(LITERAL_MATCH_RELEVANCE, 3)
  assert.match(sql, /1 \+ GREATEST\(\s*COALESCE\(strict_word_similarity/)
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

test('close spellings are looked for only when no title matched literally', () => {
  // Only synopsis matches: the name may be misspelled.
  assert.equal(foundByTitle([0, 0]), false)
  assert.equal(foundByTitle([]), false)
  // Any title by name, contained or better (NUMERIC-like strings too): no close pass.
  assert.equal(foundByTitle([0, 3]), true)
  assert.equal(foundByTitle(['5']), true)
  // A close match is not a literal one.
  assert.equal(foundByTitle([1.9]), false)
})

test('a detail lookup answers with the better match; a tie goes to the film', () => {
  assert.equal(pickTitleMatch(null, null), null)
  assert.equal(pickTitleMatch(3, null), 'movie')
  assert.equal(pickTitleMatch(null, 1.6), 'series')
  // "The Office": the show is exact, a film only contains the words.
  assert.equal(pickTitleMatch(3, 5), 'series')
  assert.equal(pickTitleMatch(5, 5), 'movie')
  assert.equal(pickTitleMatch('4', '3'), 'movie')
})
