import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JellyfinProviderBase } from './base.js'
import { getLibraries } from './libraries.js'
import { resolveAdminUserId, updateJellyfinItem, updateJellyfinItemSafely } from './itemUpdates.js'
import { createOrUpdateCollection } from './collections.js'
import { mapJellyfinItemToMovie } from './mappers.js'
import { mapVideoQuality } from '../videoQuality.js'
import type { JellyfinItem } from './types.js'

interface Call {
  endpoint: string
  method: string
  body?: Record<string, unknown>
}

type Route = (call: Call) => unknown

/**
 * Minimal stand-in for JellyfinProviderBase that records every request and answers from a
 * route table. Requests with no matching route fail like an HTTP error would.
 */
function fakeProvider(route: Route) {
  const calls: Call[] = []
  const provider = {
    baseUrl: 'http://jf:8096',
    async fetch(endpoint: string, _apiKey: string, options: RequestInit = {}) {
      const call: Call = {
        endpoint,
        method: options.method ?? 'GET',
        body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
      }
      calls.push(call)
      return route(call)
    },
  }
  return { provider: provider as unknown as JellyfinProviderBase, calls }
}

const users = [
  { Id: 'u-disabled', Name: 'old', ServerId: 's', Policy: { IsAdministrator: true, IsDisabled: true } },
  { Id: 'u-user', Name: 'kid', ServerId: 's', Policy: { IsAdministrator: false, IsDisabled: false } },
  { Id: 'u-admin', Name: 'root', ServerId: 's', Policy: { IsAdministrator: true, IsDisabled: false } },
]

test('getLibraries uses ItemId, which is what /Library/VirtualFolders returns', async () => {
  const { provider } = fakeProvider(() => [
    { Name: 'Movies', ItemId: 'lib-1', CollectionType: 'movies' },
    { Name: 'Legacy', Id: 'legacy-id', CollectionType: 'tvshows' },
  ])
  const libs = await getLibraries(provider, 'key')

  assert.equal(libs[0].id, 'lib-1')
  assert.equal(libs[0].guid, 'lib-1')
  // Falls back to Id if a server ever returns it instead
  assert.equal(libs[1].id, 'legacy-id')
  assert.equal(libs[1].guid, 'legacy-id')
})

test('resolveAdminUserId picks an enabled administrator and caches it per provider', async () => {
  const { provider, calls } = fakeProvider((c) => (c.endpoint === '/Users' ? users : null))

  assert.equal(await resolveAdminUserId(provider, 'key'), 'u-admin')
  assert.equal(await resolveAdminUserId(provider, 'key'), 'u-admin')
  assert.equal(calls.filter((c) => c.endpoint === '/Users').length, 1)
})

test('resolveAdminUserId fails clearly when there is no usable administrator', async () => {
  const { provider } = fakeProvider(() => [users[0], users[1]])
  await assert.rejects(resolveAdminUserId(provider, 'key'), /No enabled administrator/)
})

test('updateJellyfinItem reads with user context (never GET /Items/{id}) and posts to /Items/{id}', async () => {
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint === '/Users/u-admin/Items/item-1') return { Id: 'item-1', Name: 'Heat' }
    if (c.endpoint === '/Items/item-1' && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await updateJellyfinItem(provider, 'key', 'item-1', (item) => {
    item.ForcedSortName = '01 - Heat'
  })

  assert.equal(
    calls.some((c) => c.method === 'GET' && c.endpoint === '/Items/item-1'),
    false
  )
  const post = calls.find((c) => c.method === 'POST')
  assert.equal(post?.endpoint, '/Items/item-1')
  assert.deepEqual(post?.body, { Id: 'item-1', Name: 'Heat', ForcedSortName: '01 - Heat' })
})

test('updateJellyfinItemSafely swallows failures', async () => {
  const { provider } = fakeProvider(() => {
    throw new Error('HTTP 500')
  })
  await updateJellyfinItemSafely(provider, 'key', 'item-1', () => {}, { operation: 'test' })
})

test('new collection gets a top sort title and ranked item sort names', async () => {
  const items: Record<string, Record<string, unknown>> = {
    c1: { Id: 'c1', Name: 'Top Picks' },
    m1: { Id: 'm1', Name: 'Heat', LockedFields: ['Name'] },
    m2: { Id: 'm2', Name: 'Ronin' },
  }
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint.startsWith('/Items?') && c.method === 'GET') return { Items: [] }
    if (c.endpoint.startsWith('/Collections?') && c.method === 'POST') return { Id: 'c1' }
    const read = c.endpoint.match(/^\/Users\/u-admin\/Items\/(\w+)$/)
    if (read && c.method === 'GET') return structuredClone(items[read[1]])
    if (c.endpoint.match(/^\/Items\/\w+$/) && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  const result = await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1', 'm2'])
  assert.equal(result.collectionId, 'c1')

  const posted = (id: string) => calls.find((c) => c.method === 'POST' && c.endpoint === `/Items/${id}`)?.body
  assert.deepEqual(posted('c1'), {
    Id: 'c1',
    Name: 'Top Picks',
    ForcedSortName: '!!!!!!Top Picks',
    LockedFields: ['SortName'],
  })
  assert.equal(posted('m1')?.ForcedSortName, '01 - Heat')
  assert.deepEqual(posted('m1')?.LockedFields, ['Name', 'SortName'])
  assert.equal(posted('m2')?.ForcedSortName, '02 - Ronin')
  // Admin lookup happens once for the whole run
  assert.equal(calls.filter((c) => c.endpoint === '/Users').length, 1)
})

test('mapVideoQuality reads resolution and codecs from the primary source', () => {
  const quality = mapVideoQuality({
    Container: 'mkv',
    MediaStreams: [
      { Type: 'Audio', Codec: 'eac3' },
      { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160 },
    ],
  })
  assert.deepEqual(quality, {
    videoResolution: '3840x2160',
    videoCodec: 'hevc',
    audioCodec: 'eac3',
    container: 'mkv',
  })

  assert.equal(mapVideoQuality(undefined).videoResolution, undefined)
  assert.equal(mapVideoQuality({ MediaStreams: [{ Type: 'Video', Codec: 'h264' }] }).videoResolution, undefined)
})

test('Jellyfin movie mapper now fills in video quality', () => {
  const item = {
    Id: 'm1',
    Name: 'Heat',
    MediaSources: [
      {
        Id: 's1',
        Path: '/movies/heat.mkv',
        Container: 'mkv',
        MediaStreams: [
          { Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080 },
          { Type: 'Audio', Codec: 'ac3' },
        ],
      },
    ],
  } as unknown as JellyfinItem

  const movie = mapJellyfinItemToMovie(item, 'http://jf:8096')
  assert.equal(movie.videoResolution, '1920x1080')
  assert.equal(movie.videoCodec, 'h264')
  assert.equal(movie.audioCodec, 'ac3')
  assert.equal(movie.container, 'mkv')
})
