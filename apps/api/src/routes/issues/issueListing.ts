/**
 * Which issues the Issues tab shows, and in what order.
 *
 * Pure, so the rules are pinned by a test without Seerr or a database. Seerr's
 * `GET /issue` filters by state and sorts by added/modified only; the problem
 * type, the title order and "latest activity" are decided here, over the list
 * the route read whole. A reply does not move Seerr's `updatedAt`, so latest
 * activity reads the newest comment too. The state is Seerr's to filter and is
 * not filtered again here: a second copy of that rule would hide a mismatch.
 *
 * The default order is latest activity, the nearest to Seerr's `modified`
 * order the tab showed before it could be chosen.
 */
import type { IssueKind, IssueView } from './issueMapping.js'

export const ISSUE_SORTS = ['latestActivity', 'newest', 'oldest', 'titleAsc', 'titleDesc'] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]

export const ISSUE_STATE_FILTERS = ['all', 'open', 'resolved'] as const
export type IssueStateFilter = (typeof ISSUE_STATE_FILTERS)[number]

export const ISSUE_KIND_FILTERS = ['all', 'video', 'audio', 'subtitles', 'other'] as const
export type IssueKindFilter = (typeof ISSUE_KIND_FILTERS)[number]

/** A bound on one listing: past it the oldest issues are left out, and the answer says so. */
export const ISSUE_LIST_MAX = 500

export interface IssueListView {
  state: IssueStateFilter
  kind: IssueKindFilter
  sort: IssueSort
  /** The viewer's language for the title order; null = the server's default collation. */
  locale: string | null
}

/** A language tag Intl accepts, else null (an invalid tag makes `Intl.Collator` throw). */
export function readLocale(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    return Intl.Collator.supportedLocalesOf([raw])[0] ?? null
  } catch {
    return null
  }
}

/** Anything unrecognised reads as the default, never as an error or an empty list. */
export function readIssueListView(query: {
  filter?: string
  kind?: string
  sort?: string
  lang?: string
}): IssueListView {
  const pick = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T =>
    raw != null && (list as readonly string[]).includes(raw) ? (raw as T) : fallback
  return {
    state: pick(ISSUE_STATE_FILTERS, query.filter, 'all'),
    kind: pick(ISSUE_KIND_FILTERS, query.kind, 'all'),
    sort: pick(ISSUE_SORTS, query.sort, 'latestActivity'),
    locale: readLocale(query.lang),
  }
}

type ListedIssue = Pick<IssueView, 'id' | 'kind' | 'createdAt' | 'updatedAt'> & {
  comments: { createdAt: string }[]
  libraryTitle: string | null
}

function time(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : 0
}

/** The newest of the issue's own change and its newest reply. */
export function lastActivityAt(issue: Pick<ListedIssue, 'createdAt' | 'updatedAt' | 'comments'>): number {
  let latest = Math.max(time(issue.createdAt), time(issue.updatedAt))
  for (const comment of issue.comments) latest = Math.max(latest, time(comment.createdAt))
  return latest
}

/**
 * Seerr pages can shift while they are read (an issue filed or resolved in
 * between), so one issue may arrive twice. The first copy wins.
 */
export function uniqueById<T extends { id: number }>(issues: readonly T[]): T[] {
  const seen = new Set<number>()
  return issues.filter((issue) => (seen.has(issue.id) ? false : (seen.add(issue.id), true)))
}

export function listIssues<T extends ListedIssue>(
  issues: readonly T[],
  view: Pick<IssueListView, 'kind' | 'sort' | 'locale'>
): T[] {
  const collator = new Intl.Collator(view.locale ?? undefined, { sensitivity: 'base', numeric: true })
  const kept = issues.filter((issue) => view.kind === 'all' || issue.kind === (view.kind as IssueKind))
  // Ties fall back to the newest report, then the id, so an order never shuffles between reads.
  const newestFirst = (a: T, b: T) => time(b.createdAt) - time(a.createdAt) || b.id - a.id
  const byTitle = (a: T, b: T, direction: 1 | -1) => {
    // A title the library does not hold sorts last in either direction.
    if (a.libraryTitle == null || b.libraryTitle == null) {
      if (a.libraryTitle === b.libraryTitle) return newestFirst(a, b)
      return a.libraryTitle == null ? 1 : -1
    }
    return direction * collator.compare(a.libraryTitle, b.libraryTitle) || newestFirst(a, b)
  }
  const compare: Record<IssueSort, (a: T, b: T) => number> = {
    newest: newestFirst,
    oldest: (a, b) => -newestFirst(a, b),
    latestActivity: (a, b) => lastActivityAt(b) - lastActivityAt(a) || newestFirst(a, b),
    titleAsc: (a, b) => byTitle(a, b, 1),
    titleDesc: (a, b) => byTitle(a, b, -1),
  }
  return [...kept].sort(compare[view.sort])
}
