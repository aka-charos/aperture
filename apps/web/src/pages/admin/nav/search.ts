import {
  ADMIN_ENTRIES,
  ADMIN_GROUPS,
  adminEntryPath,
  type AdminEntry,
  type AdminField,
  type AdminGroupId,
} from './registry'
import {
  ALL_JOB_NAMES,
  JOB_DISPLAY_NAME_KEYS,
  jobAnchor,
  jobCategoryFor,
  titleCaseJobName,
} from '@/pages/jobs/registry'

/**
 * The settings palette's index, built from the registry.
 *
 * Three tiers. Every entry is searchable by its own title for free, which is
 * what makes the index impossible to forget to update — a section that has a
 * route has a search result. Fields are opt-in per entry, for the controls
 * people actually hunt for, and they carry an anchor so Enter lands on the
 * control rather than on the page holding it.
 *
 * The third tier is the **jobs**, and it is not optional the way fields are.
 * Jobs are the largest set of named, actionable things in the console — 28 of
 * them — and until they were indexed, typing one of their names landed you on a
 * settings page that merely mentioned the word: `sync movies` reached Libraries,
 * `rebuild taste profiles` reached a slider called "Borrowed from a taste twin",
 * `studio logos` reached nothing at all, and `full reset recommendations` put
 * the destructive database purge at the top of the list. They come from the same
 * array the jobs page renders, so the index cannot list a job that has no card.
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

/** A weighted piece of text a result can be found by. */
type Haystack = readonly [text: string, weight: number]

const GROUP_LABELS = new Map<AdminGroupId, string>()

function entryHaystacks(entry: AdminEntry, t: Translate): Haystack[] {
  return [
    [t(entry.titleKey), 100],
    // The group name is part of how people say where a thing is — "ai
    // embedding model" names the group, the subject and the noun, and only the
    // middle word is in the title.
    [GROUP_LABELS.get(entry.group) ?? '', 40],
    [t(entry.blurbKey), 20],
    ...entry.aliases.map((alias): Haystack => [alias, 70]),
  ]
}

function fieldHaystacks(field: AdminField, parentTitle: string, t: Translate): Haystack[] {
  return [
    [t(field.labelKey), 90],
    // A control is almost never named in full: people type one word for the
    // control and one for the section it lives in ("novelty weight", where the
    // label is "Genre Discovery" and only the section says "weights").
    [parentTitle, 45],
    ...(field.aliases ?? []).map((alias): Haystack => [alias, 60]),
  ]
}

/** What a job can be found by. Its name is the whole of it. */
function jobHaystacks(name: string, displayName: string): Haystack[] {
  return [
    [displayName, 100],
    // The kebab id with its hyphens opened up, so `sync-movies` pasted from a
    // log line or an API response finds the card, and so the words match in
    // either order.
    [name.replace(/-/g, ' '), 80],
  ]
  // Deliberately no "job" keyword here: a bare `jobs` should reach the jobs
  // page, which the entry already answers, not list all twenty-eight cards.
}

/**
 * How well one token does against a result's text, taking its best hit.
 * Zero means the token found nothing here at all.
 */
function scoreToken(haystacks: readonly Haystack[], token: string): number {
  let best = 0
  for (const [text, weight] of haystacks) {
    best = Math.max(best, matchScore(text, token, weight))
  }
  return best
}

interface TokenScore {
  matched: number
  score: number
}

/**
 * Every token is scored separately and they are summed.
 *
 * The query used to be matched as one string, on the reasoning that settings
 * names are often two words and splitting them makes two weak matches instead
 * of one strong one. That was wrong in the way that matters: nobody types a
 * label verbatim. "ai embedding model", "novelty weight", "backup database" and
 * "trusted proxy" all returned **nothing**, because no single indexed string
 * contains any of them — the words are spread across the group name, the title,
 * the blurb and the aliases, which is exactly where you would expect to find
 * them.
 */
function scoreTokens(haystacks: readonly Haystack[], tokens: readonly string[]): TokenScore {
  let matched = 0
  let score = 0
  for (const token of tokens) {
    const best = scoreToken(haystacks, token)
    if (best > 0) {
      matched++
      score += best
    }
  }
  return { matched, score }
}

const GROUP_ORDER = new Map<AdminGroupId, number>(ADMIN_GROUPS.map((g, i) => [g.id, i]))

/**
 * Ranked destinations for a query.
 *
 * A result must match at least one token, and results that matched *more* of
 * them always rank above results that matched fewer — so a full match wins
 * outright, and a query with a stray word ("the api key") degrades to the best
 * partial matches instead of returning nothing.
 */
export function searchAdmin(query: string, t: Translate): AdminSearchResult[] {
  // Hyphens split like whitespace, so a kebab id pasted from a log or an API
  // response (`generate-title-analysis`) searches as the words it is made of.
  const tokens = query.trim().toLowerCase().split(/[\s-]+/).filter(Boolean)
  if (tokens.length === 0) return []

  // Translated once per search rather than once per entry per token.
  GROUP_LABELS.clear()
  for (const group of ADMIN_GROUPS) GROUP_LABELS.set(group.id, t(group.labelKey))

  const results: (AdminSearchResult & { matched: number })[] = []

  for (const entry of ADMIN_ENTRIES) {
    const path = adminEntryPath(entry)
    const title = t(entry.titleKey)

    const entryHit = scoreTokens(entryHaystacks(entry, t), tokens)
    if (entryHit.matched > 0) {
      results.push({
        key: entry.id,
        entryId: entry.id,
        group: entry.group,
        path,
        title,
        blurb: t(entry.blurbKey),
        score: entryHit.score,
        matched: entryHit.matched,
      })
    }

    for (const field of entry.fields ?? []) {
      const fieldHit = scoreTokens(fieldHaystacks(field, title, t), tokens)
      if (fieldHit.matched === 0) continue
      results.push({
        key: `${entry.id}#${field.anchor}`,
        entryId: entry.id,
        group: entry.group,
        path: `${path}#${field.anchor}`,
        title: t(field.labelKey),
        parentTitle: title,
        // Breaks a tie toward the section: a query that scores a section and
        // one of its own fields equally means the section. It does not hold a
        // field below every section — a query naming a control ("api key")
        // should reach the control, not the eleven cards that mention one.
        score: fieldHit.score - 1,
        matched: fieldHit.matched,
      })
    }
  }

  // Jobs. One entry owns them all, so the path is resolved once.
  const jobsEntry = ADMIN_ENTRIES.find((e) => e.id === 'jobs')
  if (jobsEntry) {
    const jobsPath = adminEntryPath(jobsEntry)
    for (const name of ALL_JOB_NAMES) {
      const key = JOB_DISPLAY_NAME_KEYS[name]
      const displayName = key ? t(key) : titleCaseJobName(name)
      const hit = scoreTokens(jobHaystacks(name, displayName), tokens)
      if (hit.matched === 0) continue
      results.push({
        key: `job:${name}`,
        entryId: jobsEntry.id,
        group: jobsEntry.group,
        path: `${jobsPath}#${jobAnchor(name)}`,
        title: displayName,
        // The category, so a result reads "Movie AI › Generate Movie
        // Embeddings" rather than leaving two similarly-named jobs to be told
        // apart by their titles alone.
        parentTitle: t(jobCategoryFor(name)?.titleKey ?? jobsEntry.titleKey),
        score: hit.score - 1,
        matched: hit.matched,
      })
    }
  }

  results.sort((a, b) => {
    // Covering more of what was typed beats scoring higher on less of it.
    if (b.matched !== a.matched) return b.matched - a.matched
    if (b.score !== a.score) return b.score - a.score
    const groupDelta = (GROUP_ORDER.get(a.group) ?? 0) - (GROUP_ORDER.get(b.group) ?? 0)
    if (groupDelta !== 0) return groupDelta
    return a.title.localeCompare(b.title)
  })

  /**
   * Once something answers the whole query, nothing answering less of it is
   * worth showing. `api key` used to return fifteen rows and `tmdb key`
   * seventeen — the two useful ones, then every card that happens to mention a
   * key. This is a floor relative to the best result rather than an absolute
   * one, so it never empties a search: if the best any result manages is one
   * token of three, all the one-token results stay.
   */
  const bestMatched = results[0]?.matched ?? 0
  const kept = results.filter((r) => r.matched === bestMatched)

  return kept.slice(0, MAX_RESULTS).map(({ matched: _matched, ...result }) => result)
}
