import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createStripQueue } from './stripQueue'
import {
  forgetUnanswered,
  MAX_STATUS_ATTEMPTS,
  mediaKey,
  pendingStatusBatches,
  typedStatuses,
  type StatusItem,
} from './statusBatches'
import type { SeerrMediaStatus } from '../types'

const available: SeerrMediaStatus = { exists: true, status: 'available', requested: false }

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A queue whose rows finish when told to. */
function controlledQueue(concurrency?: number) {
  const started: string[] = []
  const signals = new Map<string, AbortSignal>()
  const finishers = new Map<string, () => void>()
  const queue = createStripQueue((key, signal) => {
    started.push(key)
    signals.set(key, signal)
    return new Promise<void>((resolve) => finishers.set(key, resolve))
  }, concurrency)
  return { queue, started, signals, finish: (key: string) => finishers.get(key)?.() }
}

test('two rows load at once, in the order they came into view', async () => {
  const { queue, started, finish } = controlledQueue()
  for (const key of ['a', 'b', 'c', 'd']) queue.enqueue(key, () => true)
  await tick()
  assert.deepEqual(started, ['a', 'b'])

  finish('a')
  await tick()
  assert.deepEqual(started, ['a', 'b', 'c'])
  finish('b')
  finish('c')
  await tick()
  assert.deepEqual(started, ['a', 'b', 'c', 'd'])
})

test('a row waiting or running is not queued twice; a refused one is not queued', async () => {
  const { queue, started, finish } = controlledQueue(1)
  queue.enqueue('a', () => true)
  queue.enqueue('a', () => true)
  queue.enqueue('b', () => true)
  queue.enqueue('b', () => true)
  queue.enqueue('c', () => false)
  await tick()
  finish('a')
  await tick()
  finish('b')
  await tick()
  assert.deepEqual(started, ['a', 'b'])
})

test('a failing row does not stop the others', async () => {
  const started: string[] = []
  const queue = createStripQueue(async (key) => {
    started.push(key)
    throw new Error('no')
  }, 1)
  queue.enqueue('a', () => true)
  queue.enqueue('b', () => true)
  await tick()
  await tick()
  await tick()
  assert.deepEqual(started, ['a', 'b'])
})

test('a reset aborts what runs, drops what waits, and an old row cannot free a slot', async () => {
  const { queue, started, signals, finish } = controlledQueue(1)
  queue.enqueue('old', () => true)
  queue.enqueue('waiting', () => true)
  await tick()
  queue.reset()
  assert.equal(signals.get('old')?.aborted, true)

  queue.enqueue('new', () => true)
  queue.enqueue('next', () => true)
  await tick()
  assert.deepEqual(started, ['old', 'new'])

  finish('old')
  await tick()
  assert.deepEqual(started, ['old', 'new'], 'the slot is still held by the new row')
  finish('new')
  await tick()
  assert.deepEqual(started, ['old', 'new', 'next'])
})

test('each title is asked about once, and one request holds one media type', () => {
  const items: StatusItem[] = [
    { tmdbId: 1, mediaType: 'movie' },
    { tmdbId: 1, mediaType: 'series' },
    { tmdbId: 2, mediaType: 'movie' },
    { tmdbId: 2, mediaType: 'movie' },
    { tmdbId: 0, mediaType: 'movie' },
  ]
  const asked = new Set<string>()
  const batches = pendingStatusBatches(items, asked)
  assert.deepEqual(batches, [
    {
      mediaType: 'movie',
      items: [
        { tmdbId: 1, mediaType: 'movie' },
        { tmdbId: 2, mediaType: 'movie' },
      ],
    },
    { mediaType: 'series', items: [{ tmdbId: 1, mediaType: 'series' }] },
  ])
  assert.deepEqual(pendingStatusBatches(items, asked), [])
})

test('a long list is split at what the route accepts', () => {
  const items: StatusItem[] = Array.from({ length: 205 }, (_, i) => ({
    tmdbId: i + 1,
    mediaType: 'movie',
  }))
  const sizes = pendingStatusBatches(items, new Set()).map((batch) => batch.items.length)
  assert.deepEqual(sizes, [100, 100, 5])
})

test('an answer lands under its own media type, and a missing one stays missing', () => {
  const typed = typedStatuses(
    {
      mediaType: 'series',
      items: [
        { tmdbId: 7, mediaType: 'series' },
        { tmdbId: 8, mediaType: 'series' },
      ],
    },
    { 7: available }
  )
  assert.deepEqual(typed, { [mediaKey('series', 7)]: available })
  assert.deepEqual(typedStatuses({ mediaType: 'movie', items: [] }, undefined), {})
})

test('an unanswered title goes back to be asked, a few times; an answered one never does', () => {
  const items: StatusItem[] = [
    { tmdbId: 1, mediaType: 'movie' },
    { tmdbId: 2, mediaType: 'movie' },
  ]
  const asked = new Set<string>()
  const attempts = new Map<string, number>()
  const answers = { [mediaKey('movie', 1)]: available }

  for (let round = 1; round <= MAX_STATUS_ATTEMPTS; round++) {
    const [batch] = pendingStatusBatches(items, asked)
    assert.deepEqual(
      batch.items.map((item) => item.tmdbId),
      round === 1 ? [1, 2] : [2]
    )
    assert.equal(forgetUnanswered(batch, answers, asked, attempts), round < MAX_STATUS_ATTEMPTS)
  }
  assert.deepEqual(pendingStatusBatches(items, asked), [])
})

test('a list never waits for Seerr, and rows do not ask for it inline', () => {
  const data = source('./useDiscoveryData.ts')
  assert.doesNotMatch(data, /\/api\/seerr\/status/)
  for (const route of ['tmdbGenreRows', 'streaming']) {
    const code = readFileSync(
      fileURLToPath(new URL(`../../../../../api/src/routes/discovery/${route}.ts`, import.meta.url)),
      'utf8'
    )
    assert.doesNotMatch(code, /batchGetSeerrMediaStatus/, route)
  }
})

test("one person's suggestions are never kept in the browser", () => {
  const data = source('./useDiscoveryData.ts')
  assert.doesNotMatch(data, /localStorage\.(getItem|setItem)/)
})

test('only the shared poll asks what jobs are running, and viewers never ask', () => {
  const status = source('./useDiscoveryJobStatus.ts')
  assert.doesNotMatch(status, /fetch\(/)
  assert.match(status, /useActiveJobs\(Boolean\(user\?\.isAdmin\)\)/)
})

test('portraits and posters off screen are not requested', () => {
  assert.match(source('../../browse/components/BrowsePersonCard.tsx'), /loading="lazy"/)
  assert.match(source('../../browse/components/BrowsePersonRow.tsx'), /loading: 'lazy'/)
  assert.match(source('../../../components/MediaPosterCard.tsx'), /loading="lazy"/)
})
