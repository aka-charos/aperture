/**
 * Title normalization for matching a web-sourced title against a library row.
 *
 * Three copies of this function existed — in resolveCandidates, webCandidates
 * and discoveryResolve — all identical, and all with the same defect: they
 * stripped every character outside [a-z0-9], which DELETES accented letters
 * rather than folding them. "L'échafaud" became "l chafaud" while
 * "L'echafaud" became "l echafaud", so the two spellings of the same film did
 * not match each other. That is the exact shape of the problem in a library
 * where 30% of films carry a non-English original title.
 *
 * Normalizing here is only half the job: the SQL side has to match
 * accent-insensitively too (see the unaccent() calls in resolveCandidates and
 * the search tools), or the row never reaches this comparison.
 */

/**
 * Latin letters with no combining-mark decomposition, so NFD cannot reach them.
 * Nordic, Polish and German cinema all hit this; without the map, "Rødt" and
 * "Rodt" or "Straße" and "Strasse" stay unequal after normalization.
 */
const LIGATURES: Array<[RegExp, string]> = [
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ß/g, 'ss'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/[đð]/g, 'd'],
  [/þ/g, 'th'],
  [/ı/g, 'i'],
]

/**
 * Fold a title to a comparable key: accents removed, ligatures expanded,
 * lowercase, punctuation collapsed to single spaces.
 *
 * NFD first so "é" splits into "e" + combining acute and the mark can be
 * dropped; lowercasing after that keeps "ẞ" → "ß" reachable by the map below.
 */
export function normalizeTitle(title: string): string {
  let s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  for (const [pattern, replacement] of LIGATURES) s = s.replace(pattern, replacement)
  return s.replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Do two titles refer to the same thing? Containment either way, because a web
 * source routinely adds or drops a subtitle ("Le Samouraï" / "Le Samourai: The
 * Godson"). Empty on either side is NOT a match — callers that want to treat an
 * unknown title as acceptable must decide that themselves, since the right
 * answer differs between "validate an exact ID hit" and "find a row by name".
 */
export function titlesOverlap(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * The three name columns every `movies`/`series` lookup should search.
 *
 * `alias` is the table alias ('' for an unaliased FROM). `param` is a `$n`
 * PLACEHOLDER, never a value — nothing user-supplied is interpolated here, so
 * these builders cannot introduce injection; keep it that way.
 *
 * unaccent() means a source writing "Ascenseur pour l'echafaud" still finds the
 * accented row. It costs the trigram indexes from 0060 and falls back to a
 * sequential scan, which is milliseconds at library scale — see 0134.
 */
export function anyTitleMatchesSql(param: string, alias = ''): string {
  const p = alias ? `${alias}.` : ''
  return `(unaccent(${p}title) ILIKE unaccent(${param})
        OR unaccent(COALESCE(${p}original_title, '')) ILIKE unaccent(${param})
        OR unaccent(COALESCE(${p}sort_title, '')) ILIKE unaccent(${param}))`
}

/**
 * ORDER BY fragment ranking an exact hit on each name column, best first. The
 * localized title outranks the original so a search for a name the user can see
 * on the poster is never beaten by a row that merely matches in another
 * language. `param` is a `$n` placeholder holding the RAW title, not a pattern.
 */
export function titleMatchRankSql(param: string, alias = ''): string {
  const p = alias ? `${alias}.` : ''
  return `CASE
            WHEN unaccent(LOWER(${p}title)) = unaccent(LOWER(${param})) THEN 0
            WHEN unaccent(LOWER(COALESCE(${p}original_title, ''))) = unaccent(LOWER(${param})) THEN 1
            WHEN unaccent(LOWER(COALESCE(${p}sort_title, ''))) = unaccent(LOWER(${param})) THEN 2
            ELSE 3
          END`
}
