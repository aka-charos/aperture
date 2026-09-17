/**
 * Pins how a typed query reaches Postgres.
 *
 * The first group is the failure that shipped: punctuation in a query went
 * straight into to_tsquery's syntax, so "Ready Or Not 2: Here I Come" answered
 * 500 and the search box said there were no results.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  LEXICAL_WEIGHTS,
  MAX_QUERY_TOKENS,
  MOVIE_SEARCH,
  SEMANTIC_BLEND,
  SERIES_SEARCH,
  buildLexicalSearchSql,
  buildPrefixTsquery,
  buildSemanticRerankSql,
  buildTableSearch,
  searchTokens,
  semanticPoolSize,
} from './searchSql.js'

/** Characters with a meaning in to_tsquery's own syntax. */
const TSQUERY_SYNTAX = /[:&|!()<>'\\]/

function operands(tsquery: string): string[] {
  return tsquery.split(' & ').map((part) => {
    assert.ok(part.endsWith(':*'), `operand ${part} is not a prefix match`)
    return part.slice(0, -2)
  })
}

test('a colon in the title does not reach the tsquery', () => {
  const tsquery = buildPrefixTsquery('Ready Or Not 2: Here I Come')
  assert.equal(tsquery, 'ready:* & or:* & not:* & 2:* & here:* & i:* & come:*')
})

test('no operand ever carries tsquery syntax', () => {
  const queries = [
    'Fast & Furious',
    'Mission: Impossible - Fallout',
    "Schindler's List",
    'What If...?',
    'M*A*S*H',
    '(500) Days of Summer',
    'Face/Off',
    'Love | Death | Robots',
    '!Women Art Revolution',
    'Birdman or (The Unexpected Virtue of Ignorance)',
    'back\\slash <tag>',
  ]
  for (const q of queries) {
    const tsquery = buildPrefixTsquery(q)
    assert.ok(tsquery, `${q} produced no tsquery`)
    for (const operand of operands(tsquery)) {
      assert.ok(operand.length > 0, `${q} produced an empty operand`)
      assert.doesNotMatch(operand, TSQUERY_SYNTAX, `${q} leaked syntax in ${operand}`)
      assert.doesNotMatch(operand, /\s/, `${q} left whitespace in ${operand}`)
    }
  }
})

test('an ampersand is a separator, not an empty operand', () => {
  assert.equal(buildPrefixTsquery('Fast & Furious'), 'fast:* & furious:*')
})

test('an apostrophe splits the word the way the text parser indexes it', () => {
  // to_tsvector reads "don't" as "don" + "t"; splitting the query the same way is
  // what lets it match (both halves are English stop words and drop out).
  assert.deepEqual(searchTokens("Don't Look Up"), ['don', 't', 'look', 'up'])
})

test('accented and non-Latin letters are kept whole', () => {
  assert.deepEqual(searchTokens('Amélie'), ['amélie'])
  assert.deepEqual(searchTokens('Рэкетир 2'), ['рэкетир', '2'])
  assert.deepEqual(searchTokens('千と千尋の神隠し'), ['千と千尋の神隠し'])
  // Devanagari vowel signs are combining marks; splitting on them would cut words.
  assert.deepEqual(searchTokens('दंगल'), ['दंगल'])
})

test('decomposed accents stay inside their word', () => {
  assert.deepEqual(searchTokens('Ame\u0301lie'), ['amélie'])
})

test('a query with no letters or digits yields no tsquery', () => {
  assert.equal(buildPrefixTsquery('?!'), null)
  assert.equal(buildPrefixTsquery('   '), null)
  assert.equal(buildPrefixTsquery('\u0301'), null)
})

test('a long paste is capped', () => {
  const tokens = searchTokens(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '))
  assert.equal(tokens.length, MAX_QUERY_TOKENS)
  assert.equal(tokens[0], 'word0')
})

test('the lexical weights sum to one, so an exact title scores one', () => {
  const sum = Object.values(LEXICAL_WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`)
  const blend = SEMANTIC_BLEND.lexical + SEMANTIC_BLEND.semantic
  assert.ok(Math.abs(blend - 1) < 1e-9, `semantic blend sums to ${blend}`)
})

test('containing the whole query outweighs being a short title', () => {
  // "Terminator 2: Judgment Day" (contains all of "terminator") against
  // "Terminal" (shorter, so closer as a whole string, and stemmed to the same
  // lexeme). Measured trigram values; phrase and prefix both hold for the first.
  const w = LEXICAL_WEIGHTS
  const terminator2 = w.coverage * 1 + w.closeness * 0.42 + w.text * 0.8 + w.phrase + w.prefix
  const terminal = w.coverage * 0.64 + w.closeness * 0.54 + w.text * 0.76
  assert.ok(terminator2 > terminal, `${terminator2} <= ${terminal}`)
})

test('the semantic pool is bounded both ways', () => {
  assert.equal(semanticPoolSize(1), 100)
  assert.equal(semanticPoolSize(50), 200)
  assert.equal(semanticPoolSize(100), 400)
  assert.equal(semanticPoolSize(1000), 400)
})

/** Highest `$n` in a statement, which must equal the number of parameters. */
function maxPlaceholder(sql: string): number {
  return Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
}

test('each value lands on its own placeholder, in order', () => {
  const { sql, params } = buildTableSearch({
    source: MOVIE_SEARCH,
    tsquery: 'fast:* & furious:*',
    searchKey: 'fast furious',
    filters: { genre: 'Action', yearMin: 2000, yearMax: 2010, minRtScore: 60, collection: 'Fast Saga' },
    limit: 10,
    embedding: null,
  })
  assert.deepEqual(params, ['fast:* & furious:*', 'fast furious', 'Action', 2000, 2010, 60, 'Fast Saga', 10])
  assert.equal(maxPlaceholder(sql), params.length)
  assert.match(sql, /\$3::text = ANY\(genres\)/)
  assert.match(sql, /collection_name = \$7::text/)
  assert.match(sql, /LIMIT \$8\s*$/)
  for (const value of params) {
    if (typeof value === 'string') assert.ok(!sql.includes(value), `${value} was interpolated`)
  }
})

test('a table ignores the filter that belongs to the other one', () => {
  const movies = buildTableSearch({
    source: MOVIE_SEARCH,
    tsquery: null,
    searchKey: 'office',
    filters: { network: 'NBC' },
    limit: 5,
    embedding: null,
  })
  assert.deepEqual(movies.params, [null, 'office', 5])
  assert.doesNotMatch(movies.sql, /network =/)

  const series = buildTableSearch({
    source: SERIES_SEARCH,
    tsquery: null,
    searchKey: 'office',
    filters: { network: 'NBC', collection: 'Some Collection' },
    limit: 5,
    embedding: null,
  })
  assert.deepEqual(series.params, [null, 'office', 'NBC', 5])
  assert.doesNotMatch(series.sql, /collection_name =/)
  assert.match(series.sql, /FROM series t/)
})

test('an unset or zero score filter adds no condition', () => {
  const { sql, params } = buildTableSearch({
    source: MOVIE_SEARCH,
    tsquery: 'x:*',
    searchKey: 'x',
    filters: { minRtScore: 0 },
    limit: 5,
    embedding: null,
  })
  assert.deepEqual(params, ['x:*', 'x', 5])
  assert.doesNotMatch(sql, /rt_critic_score >=/)
})

test('semantic search re-ranks a larger pool and then applies the limit', () => {
  const { sql, params } = buildTableSearch({
    source: SERIES_SEARCH,
    tsquery: 'office:*',
    searchKey: 'office',
    filters: {},
    limit: 10,
    embedding: { vector: '[0.1,0.2]', setId: 'openrouter:model', table: 'series_embeddings_3072' },
  })
  assert.deepEqual(params, ['office:*', 'office', 100, '[0.1,0.2]', 'openrouter:model', 10])
  assert.equal(maxPlaceholder(sql), params.length)
  assert.match(sql, /FROM series_embeddings_3072 e/)
  assert.match(sql, /e\.series_id = l\.id/)
})

test('the SQL builders interpolate placeholders, never values', () => {
  const sql = buildLexicalSearchSql({
    ...MOVIE_SEARCH,
    tsqueryParam: '$1',
    keyParam: '$2',
    filters: ['year >= $3'],
    limitParam: '$4',
  })
  assert.match(sql, /FROM movies t/)
  assert.match(sql, /t\.collection_name/)
  assert.match(sql, /AND year >= \$3/)
  assert.match(sql, /LIMIT \$4/)
  // The key filters through the 0178 trigram index, the tsquery through the search vector.
  assert.match(sql, /\$2::text <% t\.title_search_key/)
  assert.match(sql, /\$2::text <% t\.original_title_search_key/)
  assert.match(sql, /t\.search_vector @@ to_tsquery\('english', \$1::text\)/)

  const reranked = buildSemanticRerankSql({
    lexicalSql: sql,
    embeddingTable: 'embeddings_3072',
    idColumn: 'movie_id',
    embeddingParam: '$5',
    setIdParam: '$6',
    limitParam: '$7',
  })
  assert.match(reranked, /\$5::halfvec/)
  assert.match(reranked, /e\.model = \$6::text/)
  assert.match(reranked, /LIMIT \$7\s*$/)
})
