/**
 * Finding a title the way a person names it: exactly, without its leading
 * article ("Housemaid" for "The Housemaid"), as part of a longer title, or
 * spelled a little wrong ("Housemaids", "Godfathr"). Used by the assistant's
 * searchContent and getContentDetails.
 *
 * Built on what library search already stores (migration 0178): every title
 * and original title has a search key (`aperture_search_key`: lowercase,
 * unaccented, punctuation folded) with a trigram index. The query is folded by
 * the SAME SQL function, never a JS copy, or the two sides would disagree.
 *
 * Two passes, never one. The LITERAL pass (`literalTitleSql`) finds a title
 * that is, contains, or (articles aside) equals the query. Only when it finds
 * no title does the CLOSE pass (`closeTitleSql`) look for spellings that
 * resemble it, so a near-miss never crowds out a title, or a synopsis, that
 * says the word; and the close pass alone in its WHERE is what lets the
 * trigram indexes serve it, which an OR beside unaccent() ILIKE cannot.
 *
 * Pure: every builder returns SQL text from `$n` placeholders and column names,
 * never a value, so nothing a user typed is interpolated (pinned by the tests).
 */
import { anyTitleMatchesSql } from './titleMatch.js'

/**
 * Below this many characters a query is matched only literally: trigram
 * closeness on two or three letters finds half the library.
 */
export const FUZZY_MIN_KEY_CHARS = 4

/**
 * How close a spelling must be: strict word similarity (whole words of the
 * title against the query), as upstream uses. 0.5 keeps "Housemaids" → "The
 * Housemaid" (~0.75) and "Godfathr" → "The Godfather" (~0.58) and turns away
 * "Dune" → "Dunkirk" (~0.3). Also pg_trgm's default for the `<<%` operator,
 * but stated here so a changed setting cannot loosen it.
 */
export const CLOSE_MATCH_MIN = 0.5

/** A title that ranks at or above this matched literally (exact, articled or contained). */
export const LITERAL_MATCH_RELEVANCE = 3

/** English leading articles, as they appear in a search key (lowercase, single spaces). */
const LEADING_ARTICLE = `'^(the|an|a) '`

/** `%text%` for ILIKE, with the wildcards a title may contain (`%`, `_`, `\`) taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}

/** The query's search key, folded in SQL. `param` is a `$n` placeholder holding the raw query. */
export function queryKeySql(param: string): string {
  return `aperture_search_key(${param}::text)`
}

function columns(alias: string) {
  const p = alias ? `${alias}.` : ''
  return { titleKey: `${p}title_search_key`, originalKey: `${p}original_title_search_key` }
}

const bare = (expr: string) => `regexp_replace(${expr}, ${LEADING_ARTICLE}, '')`

/** The title or original title equals the query once a leading article is set aside on either side. */
export function articleFreeMatchSql(key: string, alias = ''): string {
  const { titleKey, originalKey } = columns(alias)
  return `(${bare(key)} = ${bare(titleKey)} OR ${bare(key)} = ${bare(originalKey)})`
}

/**
 * The literal pass: a title, original title or sort title contains the query
 * (`pattern`, accents aside), or a title equals it articles aside.
 */
export function literalTitleSql(pattern: string, key: string, alias = ''): string {
  return `(${anyTitleMatchesSql(pattern, alias)} OR ${articleFreeMatchSql(key, alias)})`
}

/**
 * The close pass: whole words of the title or original title spell nearly
 * what was asked. `<<%` is served by the 0178 trigram indexes; the explicit
 * floor keeps the bar at CLOSE_MATCH_MIN whatever pg_trgm's setting.
 */
export function closeTitleSql(key: string, alias = ''): string {
  const { titleKey, originalKey } = columns(alias)
  const close = (col: string) => `(${key} <<% ${col} AND strict_word_similarity(${key}, ${col}) >= ${CLOSE_MATCH_MIN})`
  return `(length(${key}) >= ${FUZZY_MIN_KEY_CHARS} AND (${close(titleKey)} OR ${close(originalKey)}))`
}

/**
 * How well a row's names match the query, highest first:
 *
 * - 5: a title IS the query, case, accents and punctuation aside;
 * - 4: the same once a leading "the", "a" or "an" is set aside on either side;
 * - 3: a title, original title or sort title CONTAINS the query (`pattern`);
 * - 1 to 2: a title is a close spelling (1 + strict word similarity);
 * - 0: none of these, so the row matched on something else (its synopsis).
 *
 * `pattern` is a `$n` placeholder holding `containsPattern(query)`, `key` the
 * expression from `queryKeySql`.
 */
export function titleRelevanceSql(pattern: string, key: string, alias = ''): string {
  const { titleKey, originalKey } = columns(alias)
  return `(CASE
            WHEN ${key} = ${titleKey} OR ${key} = ${originalKey} THEN 5
            WHEN ${articleFreeMatchSql(key, alias)} THEN 4
            WHEN ${anyTitleMatchesSql(pattern, alias)} THEN 3
            WHEN ${closeTitleSql(key, alias)} THEN 1 + GREATEST(
              COALESCE(strict_word_similarity(${key}, ${titleKey}), 0),
              COALESCE(strict_word_similarity(${key}, ${originalKey}), 0))
            ELSE 0
          END)::float8`
}

/** Whether a pass found a title by name (as opposed to only synopsis matches). */
export function foundByTitle(relevances: readonly (number | string)[]): boolean {
  return relevances.some((r) => Number(r) >= LITERAL_MATCH_RELEVANCE)
}

/**
 * Which media type a detail lookup answers with: the better match, a tie to
 * the film (as before films and shows were compared), none when neither found
 * one. "The Office" the show (exact) beats a film merely containing the words.
 */
export function pickTitleMatch(
  movieRelevance: number | string | null,
  seriesRelevance: number | string | null
): 'movie' | 'series' | null {
  if (movieRelevance == null) return seriesRelevance == null ? null : 'series'
  if (seriesRelevance == null) return 'movie'
  return Number(movieRelevance) >= Number(seriesRelevance) ? 'movie' : 'series'
}
