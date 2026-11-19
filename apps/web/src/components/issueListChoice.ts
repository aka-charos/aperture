/**
 * The Issues tab's filter and order choice. The server decides each one; the
 * tab only sends it. Held by the page rather than the panel, so leaving the
 * tab and coming back keeps it, as the Requests tab keeps its own.
 */
export const ISSUE_STATE_FILTERS = ['all', 'open', 'resolved'] as const
export const ISSUE_KIND_FILTERS = ['all', 'video', 'audio', 'subtitles', 'other'] as const
/** The first is the server's default order. */
export const ISSUE_SORTS = ['latestActivity', 'newest', 'oldest', 'titleAsc', 'titleDesc'] as const

export interface IssueListChoice {
  state: (typeof ISSUE_STATE_FILTERS)[number]
  kind: (typeof ISSUE_KIND_FILTERS)[number]
  sort: (typeof ISSUE_SORTS)[number]
}

export const DEFAULT_ISSUE_LIST_CHOICE: IssueListChoice = { state: 'all', kind: 'all', sort: 'latestActivity' }
