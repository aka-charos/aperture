import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearRankSortName, setForcedSortName } from './sortName.js'
import { mapWithConcurrency } from '../lib/concurrency.js'
import { mapEmbyItemToMovie } from './emby/mappers.js'
import type { EmbyItem } from './emby/types.js'

test('setForcedSortName sets the name and locks SortName once', () => {
  const item: Record<string, unknown> = { Name: 'Heat', LockedFields: ['Name'] }
  setForcedSortName(item, '01 - Heat')
  setForcedSortName(item, '02 - Heat')

  assert.equal(item.ForcedSortName, '02 - Heat')
  assert.deepEqual(item.LockedFields, ['Name', 'SortName'])
})

test('setForcedSortName can leave the lock fields alone', () => {
  const item: Record<string, unknown> = { LockedFields: ['Name'] }
  setForcedSortName(item, 'x', false)

  assert.equal(item.ForcedSortName, 'x')
  assert.deepEqual(item.LockedFields, ['Name'])
})

test('mapWithConcurrency keeps order and never exceeds the limit', async () => {
  let inFlight = 0
  let peak = 0
  const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight--
    return n * 2
  })

  assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14])
  assert.ok(peak <= 3, `peak concurrency was ${peak}`)
  assert.deepEqual(await mapWithConcurrency([], 4, async (n: number) => n), [])
})

test('Emby movie mapper still reports video quality through the shared mapper', () => {
  const item = {
    Id: 'm1',
    Name: 'Heat',
    MediaSources: [
      {
        Id: 's1',
        Path: '/movies/heat.mkv',
        Container: 'mkv',
        MediaStreams: [
          { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160 },
          { Type: 'Audio', Codec: 'eac3' },
        ],
      },
    ],
  } as unknown as EmbyItem

  const movie = mapEmbyItemToMovie(item, 'http://emby:8096')
  assert.equal(movie.videoResolution, '3840x2160')
  assert.equal(movie.videoCodec, 'hevc')
  assert.equal(movie.audioCodec, 'eac3')
  assert.equal(movie.container, 'mkv')
})

test('clearRankSortName removes only an exact "NN - <name>" and its SortName lock', () => {
  const ours: Record<string, unknown> = {
    Name: 'Heat',
    ForcedSortName: '03 - Heat',
    LockedFields: ['SortName', 'Name'],
  }
  assert.equal(clearRankSortName(ours), true)
  assert.equal(ours.ForcedSortName, undefined)
  assert.deepEqual(ours.LockedFields, ['Name'])

  // The viewer's own forced name, a prefix on another name, and an untouched item are all left
  for (const item of [
    { Name: 'Heat', ForcedSortName: '12 - Favourites', LockedFields: ['SortName'] },
    { Name: 'Heat', ForcedSortName: '03 - Ronin' },
    { Name: 'Heat', ForcedSortName: 'Heat, The' },
    { Name: 'Heat' },
  ] as Array<Record<string, unknown>>) {
    const before = structuredClone(item)
    assert.equal(clearRankSortName(item), false)
    assert.deepEqual(item, before)
  }
})

test('mapWithConcurrency starts no new item after a failure and throws the first error', async () => {
  const started: number[] = []
  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      started.push(n)
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (n === 1) throw new Error('boom')
      return n
    }),
    /boom/
  )

  // Only the calls already in flight when item 1 failed ran; the queue was not drained
  assert.ok(started.length <= 4, `started ${started.join(',')}`)
})
