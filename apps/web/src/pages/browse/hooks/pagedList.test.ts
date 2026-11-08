import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initialPagedList,
  nextPageRequest,
  pagedListReducer,
  retryRequest,
  shouldLoadMore,
  type PagedListAction,
  type PagedListState,
} from './pagedList'

/**
 * The paging rules every Browse list runs on (pagedList.ts), played out as
 * the sequences the page goes through, not read off the source.
 */

const PAGE = 2
const run = (actions: PagedListAction<string>[], from = initialPagedList<string>(true)) =>
  actions.reduce<PagedListState<string>>((state, action) => pagedListReducer(state, action), from)

const arrived = (page: number, items: string[], total = 6, append = page > 1): PagedListAction<string> => ({
  type: 'page',
  append,
  page,
  items,
  total,
  pageSize: PAGE,
})
const failed = (append: boolean): PagedListAction<string> => ({ type: 'failure', append, message: 'Could not connect' })

test('a failed "load more" keeps its page, stops scrolling from asking, and Retry asks for it', () => {
  const afterOne = run([{ type: 'request', append: false }, arrived(1, ['a', 'b'])])
  assert.equal(shouldLoadMore(afterOne, true), true)
  assert.deepEqual(nextPageRequest(afterOne), { page: 2, append: true })

  // Page 2 fails.
  const failedTwo = run([{ type: 'request', append: true }, failed(true)], afterOne)
  assert.equal(failedTwo.page, 1, 'the page number moved without a page')
  assert.deepEqual(failedTwo.items, ['a', 'b'], 'the list on screen stands')
  assert.deepEqual(failedTwo.error, { message: 'Could not connect', during: 'more' })
  // With the end of the list still on screen, scrolling must not ask again.
  assert.equal(shouldLoadMore(failedTwo, true), false)
  // Retry asks for page 2 again, not 3.
  assert.deepEqual(retryRequest(failedTwo), { page: 2, append: true })

  // Retrying clears the error while it runs, and the page lands in order.
  const retrying = pagedListReducer(failedTwo, { type: 'request', append: true })
  assert.equal(retrying.error, null)
  assert.equal(shouldLoadMore(retrying, true), false, 'a second request while one runs')
  const recovered = pagedListReducer(retrying, arrived(2, ['c', 'd']))
  assert.deepEqual(recovered.items, ['a', 'b', 'c', 'd'])
  assert.equal(recovered.page, 2)
  assert.equal(shouldLoadMore(recovered, true), true)
})

test('a failed page one shows above the list and Retry starts the list again', () => {
  const state = run([{ type: 'request', append: false }, failed(false)])
  assert.deepEqual(state.error, { message: 'Could not connect', during: 'first' })
  assert.equal(state.loading, false)
  assert.deepEqual(retryRequest(state), { page: 1, append: false })
  assert.equal(shouldLoadMore(state, true), false)
})

test("starting a new list clears the old one's error and waits for its page one", () => {
  const failedState = run([{ type: 'request', append: false }, arrived(1, ['a', 'b']), failed(true)])
  const reset = pagedListReducer(failedState, { type: 'reset' })
  assert.equal(reset.error, null)
  assert.deepEqual(reset.items, [])
  assert.equal(reset.page, 0)
  assert.equal(reset.loading, true, 'shows loading, not "nothing here", until page one')
  assert.equal(shouldLoadMore(reset, true), false)
})

test('the last page ends the list, and a hidden list never loads more', () => {
  const full = run([arrived(1, ['a', 'b'], 4), arrived(2, ['c', 'd'], 4)])
  assert.equal(full.hasMore, false)
  assert.equal(shouldLoadMore(full, true), false)

  const short = run([arrived(1, ['a'], 3)])
  assert.equal(short.hasMore, false, 'a short page is the last')

  const more = run([arrived(1, ['a', 'b'])])
  assert.equal(shouldLoadMore(more, false), false, 'another tab is showing')
})

test('cancelled requests release "load more", and a restored list is complete and error-free', () => {
  const waiting = run([arrived(1, ['a', 'b']), { type: 'request', append: true }])
  assert.equal(waiting.loadingMore, true)
  assert.equal(pagedListReducer(waiting, { type: 'cancelled' }).loadingMore, false)

  const restored = pagedListReducer(run([failed(false)]), {
    type: 'restore',
    items: ['a', 'b', 'c'],
    page: 2,
    total: 6,
    hasMore: true,
  })
  assert.equal(restored.error, null)
  assert.equal(restored.loading, false)
  assert.deepEqual(nextPageRequest(restored), { page: 3, append: true })
})
