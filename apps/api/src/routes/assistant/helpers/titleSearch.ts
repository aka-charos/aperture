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
 * Pure: every builder returns SQL text from `$n` placeholders and column names,
 * never a value, so nothing a user typed is interpolated (pinned by the tests).
 */
import { anyTitleMatchesSql } from './titleMatch.js'

/**
 * Below this many characters a query is matched only exactly or as part of a
 * title: trigram closeness on two or three letters finds half the library.
 */
export const FUZZY_MIN_KEY_CHARS = 4

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

/**
 * True when the title or original title is CLOSE to the query: similar as a
 * whole (`%`), or containing something close to it (`<%`, word similarity).
 * Both operators are served by the 0178 trigram indexes.
 */
export function closeTitleSql(key: string, alias = ''): string {
  const { titleKey, originalKey } = columns(alias)
  return `(length(${key}) >= ${FUZZY_MIN_KEY_CHARS}
        AND (${key} % ${titleKey} OR ${key} <% ${titleKey}
             OR ${key} % ${originalKey} OR ${key} <% ${originalKey}))`
}

/**
 * How well a row's names match the query, highest first:
 *
 * - 5: a title IS the query, case, accents and punctuation aside;
 * - 4: the same once a leading "the", "a" or "an" is set aside on either side;
 * - 3: a title, original title or sort title CONTAINS the query (`pattern`);
 * - 1 to 2: a title is close to it (1 + word similarity), the typo tier;
 * - 0: none of these, so the row matched on something else (its synopsis).
 *
 * `pattern` is a `$n` placeholder holding `containsPattern(query)`, `key` the
 * expression from `queryKeySql`.
 */
export function titleRelevanceSql(pattern: string, key: string, alias = ''): string {
  const { titleKey, originalKey } = columns(alias)
  const bare = (expr: string) => `regexp_replace(${expr}, ${LEADING_ARTICLE}, '')`
  return `(CASE
            WHEN ${key} = ${titleKey} OR ${key} = ${originalKey} THEN 5
            WHEN ${bare(key)} = ${bare(titleKey)} OR ${bare(key)} = ${bare(originalKey)} THEN 4
            WHEN ${anyTitleMatchesSql(pattern, alias)} THEN 3
            WHEN ${closeTitleSql(key, alias)} THEN 1 + GREATEST(
              COALESCE(word_similarity(${key}, ${titleKey}), 0),
              COALESCE(word_similarity(${key}, ${originalKey}), 0))
            ELSE 0
          END)::float8`
}
