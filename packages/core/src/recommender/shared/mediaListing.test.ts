import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MediaServerHttpError } from '../../media/httpError.js'
import { listingIsComplete } from './listingComplete.js'
import {
  fetchPageShrinking,
  MAX_SKIPPED_ITEMS,
  startPageSizing,
  type PageRetry,
  type PageSkip,
} from './pageShrinking.js'
import { streamingBatchProcess } from './syncHelpers.js'

test('a whole listing may be used to delete what it does not mention', () => {
  assert.equal(listingIsComplete({ expected: 10, fetched: 10, distinct: 10 }), true)
})

test('a short listing may not', () => {
  assert.equal(listingIsComplete({ expected: 10, fetched: 9, distinct: 9 }), false)
})

test('nor one that read an item twice and so skipped another, though the count matches', () => {
  assert.equal(listingIsComplete({ expected: 10, fetched: 10, distinct: 9 }), false)
})

test('nor one that returned more than the server said it had', () => {
  assert.equal(listingIsComplete({ expected: 10, fetched: 11, distinct: 11 }), false)
})

const failing = (status: number, body = '') => new MediaServerHttpError('Emby', status, 'Error', body)

test('a page that answers 500 is asked for again smaller, at the same offset', async () => {
  const asked: Array<[number, number]> = []
  const retries: PageRetry[] = []
  const size = startPageSizing(1000)
  const page = await fetchPageShrinking(
    async (start, limit) => {
      asked.push([start, limit])
      if (limit > 62) throw failing(500, 'SQLiteException: database disk image is malformed')
      return 'page'
    },
    4000,
    size,
    'library 3',
    { retry: (retry) => retries.push(retry), skip: () => assert.fail('nothing to skip') }
  )
  assert.equal(page, 'page')
  assert.deepEqual(asked, [[4000, 1000], [4000, 250], [4000, 62]])
  assert.equal(size.pageSize, 62, 'later pages keep the smaller size')
  assert.equal(retries[0].serverException, 'SQLiteException')
  assert.equal(retries[0].nextLimit, 250)
})

test('one item that still fails is skipped, after a second try', async () => {
  let singleTries = 0
  const skips: PageSkip[] = []
  const page = await fetchPageShrinking(
    async (_start, limit) => {
      if (limit === 1) singleTries++
      throw failing(500, 'SQLiteException')
    },
    17,
    { ...startPageSizing(4), pageSize: 1 },
    'library 3',
    { retry: () => {}, skip: (skip) => skips.push(skip) }
  )
  assert.equal(page, null)
  assert.equal(singleTries, 2)
  assert.equal(skips[0].startIndex, 17)
  assert.equal(skips[0].serverException, 'SQLiteException')
})

test('a brief 500 on one item is not a skipped item', async () => {
  let calls = 0
  const page = await fetchPageShrinking(
    async () => {
      if (++calls === 1) throw failing(500)
      return 'page'
    },
    17,
    { ...startPageSizing(4), pageSize: 1 },
    'library 3',
    { retry: () => {}, skip: () => assert.fail('it answered the second time') }
  )
  assert.equal(page, 'page')
})

test('a server failing on everything stops the sync rather than skipping the library', async () => {
  const size = { ...startPageSizing(4), pageSize: 1 }
  const on = { retry: () => {}, skip: () => {} }
  const broken = async () => {
    throw failing(500, 'SQLiteException')
  }
  for (let i = 0; i < MAX_SKIPPED_ITEMS; i++) {
    assert.equal(await fetchPageShrinking(broken, i, size, 'library 3', on), null)
  }
  await assert.rejects(
    fetchPageShrinking(broken, 99, size, 'library 3', on),
    /more than \d+ single items of library 3, the last at offset 99/
  )
})

test('pages grow back after a run of successes, up to where they started', async () => {
  const size = startPageSizing(1000)
  const on = { retry: () => {}, skip: () => {} }
  let failNext = true
  const fetchPage = async () => {
    if (failNext) {
      failNext = false
      throw failing(500)
    }
    return 'page'
  }
  await fetchPageShrinking(fetchPage, 0, size, 'library 3', on)
  assert.equal(size.pageSize, 250)
  for (let i = 0; i < 3; i++) await fetchPageShrinking(fetchPage, 0, size, 'library 3', on)
  assert.equal(size.pageSize, 1000)
  for (let i = 0; i < 8; i++) await fetchPageShrinking(fetchPage, 0, size, 'library 3', on)
  assert.equal(size.pageSize, 1000, 'never past where it started')
})

test('a skipped offset moves the walk on and its item is not counted', async () => {
  const seen: number[][] = []
  const pages: Record<number, { items: number[]; skipped?: number }> = {
    0: { items: [0, 1] },
    2: { items: [], skipped: 1 },
    3: { items: [3, 4] },
  }
  const result = await streamingBatchProcess<number>(
    async (start) => pages[start],
    5,
    async (items) => {
      seen.push(items)
      return { added: items.length, updated: 0 }
    }
  )
  assert.deepEqual(seen, [[0, 1], [3, 4]])
  assert.equal(result.totalProcessed, 4)
  // What keeps the library's cleanup off: 4 read against 5 expected.
  assert.equal(listingIsComplete({ expected: 5, fetched: result.totalProcessed, distinct: 4 }), false)
})

test('anything but a 500 is not retried', async () => {
  for (const err of [failing(401), failing(404), new Error('Failed to connect')]) {
    let calls = 0
    await assert.rejects(
      fetchPageShrinking(
        async () => {
          calls++
          throw err
        },
        0,
        startPageSizing(1000),
        'library 3',
        { retry: () => {}, skip: () => {} }
      )
    )
    assert.equal(calls, 1)
  }
})

test('the error still reads as a 404 to the code that matches on its message', () => {
  assert.match(failing(404).message, /Emby API error: 404/)
  assert.equal(new MediaServerHttpError('Jellyfin', 500, 'Error', 'x').message, 'Jellyfin API error: 500 Error')
})
