/**
 * The paging rules of a Browse list (movies, series, people), as a pure
 * reducer and three decisions, so they live in one place and a test can play
 * out a failure sequence. `usePagedList` connects them to React.
 *
 * The rules:
 *   - `page` is the last page that ARRIVED. It moves only with a page, never
 *     when a request is sent: a failed "load more" used to advance it first,
 *     so each failure silently skipped a page.
 *   - Scrolling loads more only while nothing failed (`shouldLoadMore`). With
 *     the end of the list still on screen, an observer rebuilt after a failure
 *     asked again at once, so a server that kept failing got request after
 *     request.
 *   - A failure records whether page one or a later page failed, so the page
 *     can show it where it happened (above the list, or at its end) and Retry
 *     asks again for exactly that page (`retryRequest`).
 *   - Starting a new list clears the old one's error, and a request clears
 *     its own list's error, so a message always belongs to what is on screen.
 */

export type PagedListError = {
  message: string
  /** Page one failed (nothing to show), or a later page did (the list stands). */
  during: 'first' | 'more'
}

export interface PagedListState<T> {
  items: T[]
  /** The last page that arrived; 0 before page one has. */
  page: number
  total: number
  hasMore: boolean
  /** Page one is on its way. */
  loading: boolean
  /** A later page is on its way. */
  loadingMore: boolean
  error: PagedListError | null
}

export type PagedListAction<T> =
  /** A new list is about to be asked for: empty, and waiting for page one. */
  | { type: 'reset' }
  /** A remembered list put back as it was (Back to Browse). */
  | { type: 'restore'; items: T[]; page: number; total: number; hasMore: boolean }
  | { type: 'request'; append: boolean }
  | { type: 'page'; append: boolean; page: number; items: T[]; total: number; pageSize: number }
  | { type: 'failure'; append: boolean; message: string }
  /** The list changed under requests that will now never settle. */
  | { type: 'cancelled' }

export function initialPagedList<T>(loading: boolean): PagedListState<T> {
  return { items: [], page: 0, total: 0, hasMore: true, loading, loadingMore: false, error: null }
}

export function pagedListReducer<T>(state: PagedListState<T>, action: PagedListAction<T>): PagedListState<T> {
  switch (action.type) {
    case 'reset':
      return { ...initialPagedList<T>(true) }
    case 'restore':
      return {
        items: action.items,
        page: action.page,
        total: action.total,
        hasMore: action.hasMore,
        loading: false,
        loadingMore: false,
        error: null,
      }
    case 'request':
      return action.append
        ? { ...state, loadingMore: true, error: null }
        : { ...state, loading: true, error: null }
    case 'page': {
      const items = action.append ? [...state.items, ...action.items] : action.items
      return {
        items,
        page: action.page,
        total: action.total,
        hasMore: action.items.length === action.pageSize && items.length < action.total,
        loading: false,
        loadingMore: false,
        error: null,
      }
    }
    case 'failure':
      return {
        ...state,
        loading: false,
        loadingMore: false,
        error: { message: action.message, during: action.append ? 'more' : 'first' },
      }
    case 'cancelled':
      return { ...state, loadingMore: false }
  }
}

/** Whether reaching the end of the list should ask for the next page. */
export function shouldLoadMore<T>(state: PagedListState<T>, active: boolean): boolean {
  return active && state.page > 0 && state.hasMore && !state.loading && !state.loadingMore && !state.error
}

/** The page scrolling asks for next. */
export function nextPageRequest<T>(state: PagedListState<T>): { page: number; append: true } {
  return { page: state.page + 1, append: true }
}

/** What Retry asks for: exactly the page that failed. */
export function retryRequest<T>(state: PagedListState<T>): { page: number; append: boolean } {
  return state.error?.during === 'more' ? { page: state.page + 1, append: true } : { page: 1, append: false }
}
