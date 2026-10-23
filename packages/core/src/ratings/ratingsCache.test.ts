import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRatingsCache } from './ratingsCache.js'

function harness(answers: Array<string | null>) {
  let clock = 0
  const reads: string[] = []
  const get = createRatingsCache(
    async (key: string) => {
      reads.push(key)
      return answers.shift() ?? null
    },
    () => 'fallback',
    1000,
    () => clock
  )
  return { get, reads, advance: (ms: number) => (clock += ms) }
}

test('a successful read is served for the window, then read again', async () => {
  const h = harness(['first', 'second'])
  assert.equal(await h.get('movie'), 'first')
  h.advance(999)
  assert.equal(await h.get('movie'), 'first')
  assert.equal(h.reads.length, 1)
  h.advance(1)
  assert.equal(await h.get('movie'), 'second')
  assert.equal(h.reads.length, 2)
})

test('a failure answers the fallback and is not kept', async () => {
  const h = harness([null, 'recovered'])
  assert.equal(await h.get('movie'), 'fallback')
  // Inside the window, and still read again.
  assert.equal(await h.get('movie'), 'recovered')
  assert.equal(h.reads.length, 2)
})

test('keys are cached apart', async () => {
  const h = harness(['m', 's'])
  assert.equal(await h.get('movie'), 'm')
  assert.equal(await h.get('series'), 's')
  assert.equal(await h.get('movie'), 'm')
  assert.equal(h.reads.length, 2)
})

test('concurrent callers share one read', async () => {
  const h = harness(['once'])
  const [a, b] = await Promise.all([h.get('movie'), h.get('movie')])
  assert.equal(a, 'once')
  assert.equal(b, 'once')
  assert.equal(h.reads.length, 1)
})

test('a failure does not evict a read that replaced it', async () => {
  let release: (v: string | null) => void = () => {}
  let clock = 0
  let call = 0
  const get = createRatingsCache(
    (_key: string) => {
      call++
      if (call === 1) return new Promise<string | null>((resolve) => (release = resolve))
      return Promise.resolve('fresh')
    },
    () => 'fallback',
    1000,
    () => clock
  )
  const slow = get('movie')
  clock = 2000 // the slow read's entry has expired
  assert.equal(await get('movie'), 'fresh')
  release(null) // and now the old one fails
  assert.equal(await slow, 'fallback')
  assert.equal(await get('movie'), 'fresh')
  assert.equal(call, 2)
})
