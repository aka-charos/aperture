import {
  ADMIN_ENTRIES,
  ADMIN_GROUPS,
  adminEntryPath,
  type AdminEntry,
  type AdminGroupId,
} from './registry'

/**
 * The settings palette's index, built from the registry.
 *
 * Two tiers. Every entry is searchable by its own title for free, which is what
 * makes the index impossible to forget to update — a section that has a route
 * has a search result. Fields are opt-in per entry, for the controls people
 * actually hunt for, and they carry an anchor so Enter lands on the control
 * rather than on the page holding it.
 *
 * Matching runs against the *translated* title and blurb, so an operator
 * running the console in German searches in German, plus the entry's
 * untranslated aliases, so `omdb` and `pgvector` keep working in every locale.
 *
 * Deliberately not fuzzy. The corpus is under two hundred strings; typo
 * tolerance there buys less than it costs in results that look arbitrary.
 */

export interface AdminSearchResult {
  /** Unique across both tiers — an entry id, or `entryId#anchor` for a field. */
  key: string
  entryId: string
  group: AdminGroupId
  /** Where Enter goes, including the `#anchor` for a field hit. */
  path: string
  /** Already translated by the caller. */
  title: string
  /** The section a field belongs to; undefined on a section result. */
  parentTitle?: string
  blurb?: string
  score: number
}

/** Minimal shape of i18next's `t`, so this module needs no i18next import. */
type Translate = (key: string) => string

const MAX_RESULTS = 20

/**
 * Higher is better. Prefix beats substring because someone typing `tm` means
 * TMDB rather than the four sections with "settings" in the blurb, and a title
 * hit beats a blurb hit because the title is what they are trying to name.
 */
function matchScore(haystack: string, needle: string, weight: number): number {
  const text = haystack.toLowerCase()
  if (!text) return 0
  if (text === needle) return weight * 3
  if (text.startsWith(needle)) return weight * 2
  // Word-boundary hits ("web search" for `search`) read as intentional in a way
  // that a match inside a longer word does not.
  if (text.includes(` ${needle}`)) return weight * 1.5
  if (text.includes(needle)) return weight
  return 0
}

function scoreEntry(entry: AdminEntry, needle: string, t: Translate): number {
  const title = t(entry.titleKey)
  const blurb = t(entry.blurbKey)

  let best = Math.max(matchScore(title, needle, 100), matchScore(blurb, needle, 20))
  for (const alias of entry.aliases) {
    best = Math.max(best, matchScore(alias, needle, 70))
  }
  return best
}

const GROUP_ORDER = new Map<AdminGroupId, number>(ADMIN_GROUPS.map((g, i) => [g.id, i]))

/**
 * `query` is matched as a whole rather than tokenised: two-word settings names
 * are common here ("poster display", "gap analysis") and splitting turns them
 * into two weak matches instead of one strong one.
 */
export function searchAdmin(query: string, t: Translate): AdminSearchResult[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 1) return []

  const results: AdminSearchResult[] = []

  for (const entry of ADMIN_ENTRIES) {
    const path = adminEntryPath(entry)
    const title = t(entry.titleKey)

    const entryScore = scoreEntry(entry, needle, t)
    if (entryScore > 0) {
      results.push({
        key: entry.id,
        entryId: entry.id,
        group: entry.group,
        path,
        title,
        blurb: t(entry.blurbKey),
        score: entryScore,
      })
    }

    for (const field of entry.fields ?? []) {
      const label = t(field.labelKey)
      let fieldScore = matchScore(label, needle, 90)
      for (const alias of field.aliases ?? []) {
        fieldScore = Math.max(fieldScore, matchScore(alias, needle, 60))
      }
      // Breaks a tie toward the section: a query that scores a section and
      // one of its own fields equally means the section. It does not hold a
      // field below every section — a query naming a control ("api key")
      // should reach the control, not the eleven cards that mention one.
      if (fieldScore > 0) {
        results.push({
          key: `${entry.id}#${field.anchor}`,
          entryId: entry.id,
          group: entry.group,
          path: `${path}#${field.anchor}`,
          title: label,
          parentTitle: title,
          score: fieldScore - 1,
        })
      }
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const groupDelta = (GROUP_ORDER.get(a.group) ?? 0) - (GROUP_ORDER.get(b.group) ?? 0)
    if (groupDelta !== 0) return groupDelta
    return a.title.localeCompare(b.title)
  })

  return results.slice(0, MAX_RESULTS)
}
