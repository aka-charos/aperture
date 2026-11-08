import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MediaServerHttpError } from '../../media/httpError.js'
import { listingIsComplete } from './listingComplete.js'
import { fetchPageShrinking, type PageRetry } from './pageShrinking.js'

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
  const size = { pageSize: 1000 }
  const page = await fetchPageShrinking(
    async (start, limit) => {
      asked.push([start, limit])
      if (limit > 62) throw failing(500, 'SQLiteException: database disk image is malformed')
      return 'page'
    },
    4000,
    size,
    'library 3',
    (retry) => retries.push(retry)
  )
  assert.equal(page, 'page')
  assert.deepEqual(asked, [[4000, 1000], [4000, 250], [4000, 62]])
  assert.equal(size.pageSize, 62, 'later pages keep the smaller size')
  assert.equal(retries[0].serverException, 'SQLiteException')
  assert.equal(retries[0].nextLimit, 250)
})

test('one item that still fails stops the sync and says where', async () => {
  await assert.rejects(
    fetchPageShrinking(
      async () => {
        throw failing(500, 'SQLiteException')
      },
      17,
      { pageSize: 4 },
      'library 3',
      () => {}
    ),
    /single item at offset 17 of library 3/
  )
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
        { pageSize: 1000 },
        'library 3',
        () => {}
      )
    )
    assert.equal(calls, 1)
  }
})

test('the error still reads as a 404 to the code that matches on its message', () => {
  assert.match(failing(404).message, /Emby API error: 404/)
  assert.equal(new MediaServerHttpError('Jellyfin', 500, 'Error', 'x').message, 'Jellyfin API error: 500 Error')
})
