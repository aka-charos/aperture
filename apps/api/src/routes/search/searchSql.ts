/**
 * How a typed query becomes SQL for library search, and how a title match is
 * scored. Pure — no DB — so both halves are pinned by `searchSql.test.ts`.
 *
 * Two faults lived here, one visible and one not.
 *
 * The visible one: the full-text half built its tsquery by appending `:*` to each
 * whitespace-separated word, so any punctuation went straight into to_tsquery's
 * own syntax. "Ready Or Not 2: Here I Come" produced `2::*`, "Fast & Furious"
 * produced a bare `&:*`, Postgres rejected both as a syntax error, the route
 * answered 500, and the search box said "No results found". Tokens are now runs
 * of letters, marks and digits only, so no tsquery operator can reach it.
 *
 * The quiet one: titles were ranked by `similarity(title, query)`, which compares
 * WHOLE strings and therefore punishes a long title for its length. "Terminal"
 * sat above "Terminator 2: Judgment Day" for the query "terminator", and the
 * full-text half could not separate them either, because the English stemmer
 * turns both into `termin`. The score is now led by how much of the QUERY the
 * title contains (`word_similarity`), with whole-title closeness as the
 * tie-break among titles that contain all of it.
 */

/**
 * A long paste should not become a long AND chain: every extra term is another
 * condition a title must satisfy, and past a dozen words the full-text half has
 * stopped finding anything anyway. The trigram half still sees the whole query.
 */
export const MAX_QUERY_TOKENS = 12

/**
 * The words of a query, as to_tsquery may safely receive them.
 *
 * Anything that is not a letter, combining mark or digit is a separator, which
 * is also how Postgres's own text parser reads a title — "don't" is indexed as
 * `don` + `t`, so splitting the query the same way is what makes it match.
 * A token must contain at least one letter or digit; a stray combining mark on
 * its own is dropped.
 */
export function searchTokens(text: string): string[] {
  const runs = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  return runs.filter((run) => /[\p{L}\p{N}]/u.test(run)).slice(0, MAX_QUERY_TOKENS)
}

/**
 * A prefix-matching tsquery (`word:* & word:*`), or null when the query has no
 * words at all. Null is passed through as SQL NULL, which matches nothing and
 * ranks 0 — never an empty string, which to_tsquery rejects with a notice.
 */
export function buildPrefixTsquery(text: string): string | null {
  const tokens = searchTokens(text)
  return tokens.length > 0 ? tokens.map((token) => `${token}:*`).join(' & ') : null
}

/**
 * The lexical blend. Sums to 1, so a title identical to the query scores 1.
 *
 * - `coverage` — word_similarity(query, title): how much of the query appears,
 *   contiguously, in the title. Leads, because a title that contains everything
 *   typed is the answer however much else it says.
 * - `closeness` — similarity(query, title): whole-string overlap. Among titles
 *   that all contain the query it prefers the one with least else in it, which
 *   puts "The Terminator" ahead of "Terminator 3: Rise of the Machines".
 * - `text` — ts_rank over the weighted search vector. This is the half that finds
 *   a title by its cast, director, keywords or synopsis; it is kept small because
 *   stemming makes it blind to the difference between "terminator" and "terminal".
 * - `phrase` — the query appears as whole words inside the title.
 * - `prefix` — the title starts with the query, including a half-typed last word.
 * - `exact` — the title IS the query, punctuation and accents aside.
 */
export const LEXICAL_WEIGHTS = {
  coverage: 0.4,
  closeness: 0.25,
  text: 0.15,
  phrase: 0.1,
  prefix: 0.05,
  exact: 0.05,
} as const

/**
 * With semantic search on, the lexical score still leads: the embedding half only
 * re-ranks titles the lexical half already matched, and it scores a raw cosine
 * that sits in a narrow band, so it separates little.
 */
export const SEMANTIC_BLEND = { lexical: 0.6, semantic: 0.4 } as const

/**
 * How many lexical matches the embedding half gets to re-rank. Bounded so a short
 * query matching thousands of titles ("the") costs a few hundred vector lookups,
 * not thousands.
 */
export function semanticPoolSize(limit: number): number {
  return Math.min(Math.max(limit * 4, 100), 400)
}

/** Columns every search row returns, beyond the per-table extra. */
const BASE_COLUMNS = [
  'id',
  'title',
  'original_title',
  'year',
  'genres',
  'overview',
  'poster_url',
  'community_rating',
  'rt_critic_score',
] as const

export interface TitleSearchTable {
  table: 'movies' | 'series'
  /** `collection_name` for movies, `network` for series. */
  extraColumn: 'collection_name' | 'network'
  /** The table's key column on its embedding tables. */
  idColumn: 'movie_id' | 'series_id'
}

export const MOVIE_SEARCH: TitleSearchTable = {
  table: 'movies',
  extraColumn: 'collection_name',
  idColumn: 'movie_id',
}

export const SERIES_SEARCH: TitleSearchTable = {
  table: 'series',
  extraColumn: 'network',
  idColumn: 'series_id',
}

export interface SearchFilterValues {
  genre?: string
  yearMin?: number
  yearMax?: number
  minRtScore?: number
  /** Applies to movies only; a series search ignores it. */
  collection?: string
  /** Applies to series only; a movie search ignores it. */
  network?: string
}

export interface TableSearchInput {
  source: TitleSearchTable
  /** From `buildPrefixTsquery`. */
  tsquery: string | null
  /** From `SELECT aperture_search_key($1)`; never empty here. */
  searchKey: string
  filters: SearchFilterValues
  limit: number
  /** Present only when semantic search is on and resolved. */
  embedding: { vector: string; setId: string; table: string } | null
}

/**
 * The whole query for one table, with its parameters in placeholder order.
 * Placeholders are numbered as values are added, so no fragment is ever
 * renumbered after the fact.
 */
export function buildTableSearch(input: TableSearchInput): { sql: string; params: unknown[] } {
  const { source, filters: f, limit, embedding } = input
  const params: unknown[] = []
  const param = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }

  const tsqueryParam = param(input.tsquery)
  const keyParam = param(input.searchKey)
  const filters: string[] = []
  if (f.genre) filters.push(`${param(f.genre)}::text = ANY(genres)`)
  if (f.yearMin !== undefined) filters.push(`year >= ${param(f.yearMin)}::int`)
  if (f.yearMax !== undefined) filters.push(`year <= ${param(f.yearMax)}::int`)
  if (f.minRtScore !== undefined && f.minRtScore > 0) {
    filters.push(`rt_critic_score >= ${param(f.minRtScore)}::int`)
  }
  if (f.collection && source.table === 'movies') {
    filters.push(`collection_name = ${param(f.collection)}::text`)
  }
  if (f.network && source.table === 'series') filters.push(`network = ${param(f.network)}::text`)

  const lexicalSql = buildLexicalSearchSql({
    ...source,
    tsqueryParam,
    keyParam,
    filters,
    limitParam: param(embedding ? semanticPoolSize(limit) : limit),
  })
  if (!embedding) return { sql: lexicalSql, params }

  const sql = buildSemanticRerankSql({
    lexicalSql,
    embeddingTable: embedding.table,
    idColumn: source.idColumn,
    embeddingParam: param(embedding.vector),
    setIdParam: param(embedding.setId),
    limitParam: param(limit),
  })
  return { sql, params }
}

export interface TitleSearchSqlInput extends TitleSearchTable {
  /** `$n` placeholder holding the tsquery text (or NULL). */
  tsqueryParam: string
  /** `$n` placeholder holding the query's search key, from aperture_search_key(). */
  keyParam: string
  /** Extra WHERE conditions, each already written with its own placeholders. */
  filters: string[]
  /** `$n` placeholder for how many rows to return. */
  limitParam: string
}

/**
 * The lexical search for one table, ranked and limited.
 *
 * Every argument is a column name from a closed union or a `$n` placeholder —
 * nothing a user typed is interpolated, and this function must stay that way.
 *
 * The WHERE is what the indexes serve: `%` and `<%` against the stored
 * `*_search_key` columns (migration 0178) use their trigram GIN indexes, and `@@`
 * the search-vector one. The query's own key must come from the same SQL
 * function (`SELECT aperture_search_key($1)`), or the two sides fold differently.
 *
 * `phrase` and `prefix` use position()/left() rather than LIKE, so the key needs
 * no escaping even though it came from user input (the key has no `%` or `_`
 * anyway, since the function collapses punctuation).
 */
export function buildLexicalSearchSql(input: TitleSearchSqlInput): string {
  const { table, extraColumn, filters, limitParam } = input
  // Typed at every use, so no overloaded function (length, position) is left to
  // guess what an untyped parameter is.
  const tsq = `${input.tsqueryParam}::text`
  const key = `${input.keyParam}::text`
  const columns = [...BASE_COLUMNS, extraColumn]
  const w = LEXICAL_WEIGHTS
  const extraWhere = filters.map((f) => `\n        AND ${f}`).join('')
  const titleKeys = ['t.title_search_key', 't.original_title_search_key'] as const
  const best = (fn: (k: string) => string) =>
    `GREATEST(${titleKeys.map((k) => `COALESCE(${fn(k)}, 0)`).join(', ')})`
  const anyKey = (fn: (k: string) => string) =>
    `(${titleKeys.map((k) => `COALESCE(${fn(k)}, false)`).join(' OR ')})`

  return `
    SELECT s.*,
           (${w.coverage}::float8 * s.coverage
            + ${w.closeness}::float8 * s.closeness
            + ${w.text}::float8 * LEAST(s.text_rank, 1)
            + ${w.phrase}::float8 * s.phrase
            + ${w.prefix}::float8 * s.prefix
            + ${w.exact}::float8 * s.exact)::float8 AS lexical_score
    FROM (
      SELECT ${columns.map((col) => `t.${col}`).join(', ')},
             COALESCE(ts_rank(t.search_vector, to_tsquery('english', ${tsq})), 0)::float8 AS text_rank,
             ${best((k) => `word_similarity(${key}, ${k})`)}::float8 AS coverage,
             ${best((k) => `similarity(${key}, ${k})`)}::float8 AS closeness,
             CASE WHEN ${anyKey((k) => `position(' ' || ${key} || ' ' IN ' ' || ${k} || ' ') > 0`)} THEN 1 ELSE 0 END AS phrase,
             CASE WHEN ${anyKey((k) => `left(${k}, length(${key})) = ${key}`)} THEN 1 ELSE 0 END AS prefix,
             CASE WHEN ${anyKey((k) => `${k} = ${key}`)} THEN 1 ELSE 0 END AS exact
      FROM ${table} t
      WHERE (${key} % t.title_search_key
             OR ${key} <% t.title_search_key
             OR ${key} % t.original_title_search_key
             OR ${key} <% t.original_title_search_key
             OR t.search_vector @@ to_tsquery('english', ${tsq}))${extraWhere}
    ) s
    ORDER BY lexical_score DESC, s.title ASC, s.id ASC
    LIMIT ${limitParam}
  `
}

export interface SemanticRerankSqlInput {
  /** The lexical query, limited to the candidate pool. */
  lexicalSql: string
  /** Server-resolved embedding table (`getActiveEmbeddingTableName`), never user input. */
  embeddingTable: string
  idColumn: 'movie_id' | 'series_id'
  /** `$n` placeholders: the query vector, its embedding set id, the final row count. */
  embeddingParam: string
  setIdParam: string
  limitParam: string
}

/**
 * Re-rank the lexical pool by adding the embedding similarity of each title.
 *
 * A lookup by id per candidate (served by the `(item, model)` unique index), not
 * an ANN scan, so the `ef_search` rule does not apply. The set id filter is
 * load-bearing: one dimension table can hold several models' rows for a title.
 */
export function buildSemanticRerankSql(input: SemanticRerankSqlInput): string {
  const { lexicalSql, embeddingTable, idColumn, embeddingParam, setIdParam, limitParam } = input
  const b = SEMANTIC_BLEND
  return `
    WITH lexical AS (${lexicalSql})
    SELECT l.*,
           s.semantic_sim AS semantic_similarity,
           (${b.lexical}::float8 * l.lexical_score
            + ${b.semantic}::float8 * COALESCE(s.semantic_sim, 0))::float8 AS combined_score
    FROM lexical l
    LEFT JOIN LATERAL (
      SELECT (1 - (e.embedding <=> ${embeddingParam}::halfvec))::float8 AS semantic_sim
      FROM ${embeddingTable} e
      WHERE e.${idColumn} = l.id
        AND e.model = ${setIdParam}::text
      LIMIT 1
    ) s ON true
    ORDER BY combined_score DESC, l.title ASC, l.id ASC
    LIMIT ${limitParam}
  `
}
