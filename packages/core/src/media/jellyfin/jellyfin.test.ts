import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { JellyfinProviderBase } from './base.js'
import { getLibraries } from './libraries.js'
import {
  clearAdminUserCache,
  readJellyfinItem,
  updateJellyfinItem,
  updateJellyfinItemSafely,
} from './itemUpdates.js'
import { getMovieById } from './movies.js'
import { getEpisodeById, getSeriesById } from './series.js'
import { getPersonDetails } from './persons.js'
import { createOrUpdateCollection, deleteCollection } from './collections.js'
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

beforeEach(() => clearAdminUserCache())

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

test('admin lookup is cached across provider instances for the same server', async () => {
  const route: Route = (c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint.startsWith('/Users/u-admin/Items/')) return { Id: 'x', Name: 'X' }
    return null
  }
  const first = fakeProvider(route)
  const second = fakeProvider(route)

  await updateJellyfinItem(first.provider, 'key', 'a', () => {})
  await updateJellyfinItem(second.provider, 'key', 'b', () => {})

  assert.equal(first.calls.filter((c) => c.endpoint === '/Users').length, 1)
  assert.equal(second.calls.filter((c) => c.endpoint === '/Users').length, 0)
})

test('fails clearly when there is no usable administrator', async () => {
  const { provider } = fakeProvider(() => [users[0], users[1]])
  await assert.rejects(updateJellyfinItem(provider, 'key', 'a', () => {}), /No enabled administrator/)
})

test('unrestricted administrators are tried before restricted ones', async () => {
  const restricted = {
    Id: 'u-limited',
    Name: 'limited',
    ServerId: 's',
    Policy: { IsAdministrator: true, IsDisabled: false, EnableAllFolders: false, EnabledFolders: ['x'] },
  }
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return [restricted, users[2]]
    if (c.endpoint === '/Users/u-limited/Items/item-1') throw new Error('HTTP 404')
    if (c.endpoint === '/Users/u-admin/Items/item-1') return { Id: 'item-1', Name: 'Heat' }
    if (c.endpoint === '/Items/item-1' && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await updateJellyfinItem(provider, 'key', 'item-1', (item) => {
    item.ForcedSortName = 'x'
  })

  // Unrestricted admin is tried first and succeeds, so the restricted one is never needed
  assert.equal(calls.some((c) => c.endpoint === '/Users/u-limited/Items/item-1'), false)
  assert.equal(calls.some((c) => c.method === 'POST'), true)
})

test('tries restricted administrators when the unrestricted one cannot read the item', async () => {
  const restricted = {
    Id: 'u-limited',
    Name: 'limited',
    ServerId: 's',
    Policy: { IsAdministrator: true, IsDisabled: false, EnableAllFolders: false },
  }
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return [restricted, users[2]]
    if (c.endpoint === '/Users/u-admin/Items/item-1') throw new Error('HTTP 404')
    if (c.endpoint === '/Users/u-limited/Items/item-1') return { Id: 'item-1', Name: 'Heat' }
    if (c.endpoint === '/Items/item-1' && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await updateJellyfinItem(provider, 'key', 'item-1', () => {})
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1)
})

test('mutate returning false skips the POST', async () => {
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return users
    return { Id: 'item-1', Name: 'Heat' }
  })
  await updateJellyfinItem(provider, 'key', 'item-1', () => false)
  assert.equal(calls.some((c) => c.method === 'POST'), false)
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

/** A collection that already holds m1 (ranked) and m3 (ranked, now dropped) */
function existingCollectionRoute(items: Record<string, Record<string, unknown>>): Route {
  return (c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint.startsWith('/Items?ParentId=c1')) return { Items: [{ Id: 'm1' }, { Id: 'm3' }] }
    if (c.endpoint.startsWith('/Items?') && c.method === 'GET') return { Items: [{ Id: 'c1', Name: 'Top Picks' }] }
    if (c.endpoint.startsWith('/Collections/c1/Items')) return null
    const read = c.endpoint.match(/^\/Users\/u-admin\/Items\/(\w+)$/)
    if (read && c.method === 'GET') return structuredClone(items[read[1]])
    if (c.endpoint.match(/^\/Items\/\w+$/) && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  }
}

test('items that drop out of a collection lose the rank prefix Aperture added', async () => {
  const items: Record<string, Record<string, unknown>> = {
    m1: { Id: 'm1', Name: 'Heat' },
    m2: { Id: 'm2', Name: 'Ronin' },
    // Dropped item, prefixed by an earlier run
    m3: { Id: 'm3', Name: 'Collateral', ForcedSortName: '02 - Collateral', LockedFields: ['SortName', 'Name'] },
  }
  const { provider, calls } = fakeProvider(existingCollectionRoute(items))

  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1', 'm2'])

  const posted = (id: string) => calls.find((c) => c.method === 'POST' && c.endpoint === `/Items/${id}`)?.body
  assert.equal(posted('m3')?.ForcedSortName, undefined)
  assert.deepEqual(posted('m3')?.LockedFields, ['Name'])
  // Kept items are re-ranked, not cleared
  assert.equal(posted('m1')?.ForcedSortName, '01 - Heat')
  assert.equal(posted('m2')?.ForcedSortName, '02 - Ronin')
})

test('a sort name the user set themselves is never cleared', async () => {
  const items: Record<string, Record<string, unknown>> = {
    m1: { Id: 'm1', Name: 'Heat' },
    m2: { Id: 'm2', Name: 'Ronin' },
    // Looks like a rank prefix but is not "NN - <Name>": the user's own forced sort name
    m3: { Id: 'm3', Name: 'Collateral', ForcedSortName: '12 - Favourites', LockedFields: ['SortName'] },
  }
  const { provider, calls } = fakeProvider(existingCollectionRoute(items))

  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1', 'm2'])

  assert.equal(calls.some((c) => c.method === 'POST' && c.endpoint === '/Items/m3'), false)
})

test('deleting a ranked collection clears the rank prefixes of its members', async () => {
  const items: Record<string, Record<string, unknown>> = {
    m1: { Id: 'm1', Name: 'Heat', ForcedSortName: '01 - Heat', LockedFields: ['SortName'] },
    m3: { Id: 'm3', Name: 'Collateral', ForcedSortName: '02 - Collateral', LockedFields: ['SortName'] },
  }
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint.startsWith('/Items?ParentId=c1')) return { Items: [{ Id: 'm1' }, { Id: 'm3' }] }
    if (c.endpoint === '/Items/c1' && c.method === 'DELETE') return null
    const read = c.endpoint.match(/^\/Users\/u-admin\/Items\/(\w+)$/)
    if (read && c.method === 'GET') return structuredClone(items[read[1]])
    if (c.endpoint.match(/^\/Items\/\w+$/) && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await deleteCollection(provider, 'key', 'c1', { clearRankSortNames: true })

  const posted = (id: string) => calls.find((c) => c.method === 'POST' && c.endpoint === `/Items/${id}`)?.body
  assert.equal(posted('m1')?.ForcedSortName, undefined)
  assert.deepEqual(posted('m1')?.LockedFields, [])
  assert.equal(posted('m3')?.ForcedSortName, undefined)
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

// ---------------------------------------------------------------------------------------------
// Collections that never wrote a rank prefix must not remove one
// ---------------------------------------------------------------------------------------------

test('a rankAndPin:false collection writes no sort name and clears none (existing collection)', async () => {
  const items: Record<string, Record<string, unknown>> = {
    m1: { Id: 'm1', Name: 'Heat' },
    m2: { Id: 'm2', Name: 'Ronin' },
    // Ranked "02 - Collateral" by Top Picks and also a member of this channel collection
    m3: { Id: 'm3', Name: 'Collateral', ForcedSortName: '02 - Collateral', LockedFields: ['SortName'] },
  }
  const { provider, calls } = fakeProvider(existingCollectionRoute(items))

  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1', 'm2'], { rankAndPin: false })

  // Nothing is written to any item, and no member is even read
  assert.equal(calls.some((c) => c.method === 'POST' && c.endpoint.startsWith('/Items/')), false)
  assert.equal(calls.some((c) => c.endpoint.startsWith('/Users/u-admin/Items/')), false)
})

test('deleting a collection without the option leaves every member alone', async () => {
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Items/c1' && c.method === 'DELETE') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await deleteCollection(provider, 'key', 'c1')

  assert.deepEqual(calls.map((c) => `${c.method} ${c.endpoint}`), ['DELETE /Items/c1'])
})

test('an item ranked by Top Picks keeps its prefix when a channel collection drops it', async () => {
  const topPicks: Record<string, unknown> = {
    Id: 'm3',
    Name: 'Collateral',
    ForcedSortName: '02 - Collateral',
    LockedFields: ['SortName'],
  }
  const { provider, calls } = fakeProvider(existingCollectionRoute({ m1: { Id: 'm1', Name: 'Heat' }, m3: topPicks }))

  // The channel used to hold m1 and m3 and now holds only m1
  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1'], { rankAndPin: false })

  assert.equal(calls.some((c) => c.method === 'POST' && c.endpoint === '/Items/m3'), false)
})

// ---------------------------------------------------------------------------------------------
// The collection description reaches Jellyfin
// ---------------------------------------------------------------------------------------------

test('the collection overview is written through an administrator read, never GET /Items/{id}', async () => {
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint.startsWith('/Items?') && c.method === 'GET') return { Items: [] }
    if (c.endpoint.startsWith('/Collections?') && c.method === 'POST') return { Id: 'c1' }
    if (c.endpoint === '/Users/u-admin/Items/c1') return { Id: 'c1', Name: 'My Channel' }
    if (c.endpoint === '/Items/c1' && c.method === 'POST') return null
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  })

  await createOrUpdateCollection(provider, 'key', 'My Channel', ['m1'], {
    rankAndPin: false,
    overview: 'Films to watch together',
  })

  assert.equal(calls.some((c) => c.method === 'GET' && c.endpoint === '/Items/c1'), false)
  const post = calls.find((c) => c.method === 'POST' && c.endpoint === '/Items/c1')
  assert.deepEqual(post?.body, { Id: 'c1', Name: 'My Channel', Overview: 'Films to watch together' })
})

// ---------------------------------------------------------------------------------------------
// Every by-id read goes through the same administrator read
// ---------------------------------------------------------------------------------------------

function itemReadRoute(item: Record<string, unknown>): Route {
  return (c) => {
    if (c.endpoint === '/Users') return users
    if (c.endpoint === `/Users/u-admin/Items/${item.Id}`) return structuredClone(item)
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  }
}

test('getMovieById, getSeriesById and getEpisodeById read as an administrator', async () => {
  const movie = fakeProvider(itemReadRoute({ Id: 'm1', Name: 'Heat' }))
  assert.equal((await getMovieById(movie.provider, 'key', 'm1'))?.name, 'Heat')

  const series = fakeProvider(itemReadRoute({ Id: 's1', Name: 'The Wire' }))
  assert.equal((await getSeriesById(series.provider, 'key', 's1'))?.name, 'The Wire')

  const episode = fakeProvider(itemReadRoute({ Id: 'e1', Name: 'The Target', ParentIndexNumber: 1, IndexNumber: 1 }))
  assert.equal((await getEpisodeById(episode.provider, 'key', 'e1'))?.name, 'The Target')

  for (const { calls } of [movie, series, episode]) {
    assert.equal(calls.some((c) => /^\/Items\/\w+/.test(c.endpoint)), false)
  }
})

test('getPersonDetails reads a stored person id as an administrator, with no name-search fallback', async () => {
  const { provider, calls } = fakeProvider(itemReadRoute({ Id: 'p1', Name: 'Michael Mann', Overview: 'Director' }))

  const person = await getPersonDetails(provider, 'key', { name: 'Michael Mann', personId: 'p1' })

  assert.ok(person)
  assert.equal(calls.some((c) => c.endpoint.startsWith('/Persons')), false)
})

// ---------------------------------------------------------------------------------------------
// A stale administrator list heals itself
// ---------------------------------------------------------------------------------------------

test('a deleted administrator in the cache is replaced by one re-read of the list', async () => {
  let usersNow = [users[2]] // u-admin
  const route: Route = (c) => {
    if (c.endpoint === '/Users') return usersNow
    if (c.endpoint === '/Users/u-admin/Items/x') {
      if (usersNow[0].Id !== 'u-admin') throw new Error('HTTP 404')
      return { Id: 'x' }
    }
    if (c.endpoint === '/Users/u-new/Items/x') return { Id: 'x' }
    throw new Error(`unexpected ${c.method} ${c.endpoint}`)
  }
  const first = fakeProvider(route)
  await readJellyfinItem(first.provider, 'key', 'x') // caches [u-admin]

  // u-admin is deleted; the server now has u-new
  usersNow = [{ ...users[2], Id: 'u-new', Name: 'new' }]
  const second = fakeProvider(route)
  const item = await readJellyfinItem<{ Id: string }>(second.provider, 'key', 'x')

  assert.equal(item.Id, 'x')
  assert.equal(second.calls.filter((c) => c.endpoint === '/Users').length, 1)
})

test('an item no administrator can read fails once, without looping on the list', async () => {
  const { provider, calls } = fakeProvider((c) => {
    if (c.endpoint === '/Users') return [users[2]]
    throw new Error('HTTP 404')
  })
  await readJellyfinItem(provider, 'key', 'x').then(
    () => assert.fail('expected a rejection'),
    (err: Error) => assert.match(err.message, /404/)
  )
  await readJellyfinItem(provider, 'key', 'y').then(
    () => assert.fail('expected a rejection'),
    () => undefined
  )

  // The cached list is re-read once on the second failure and found unchanged: no retry storm
  assert.ok(calls.filter((c) => c.endpoint === '/Users').length <= 2)
})

test('JellyfinProvider removes a library by its name, as Jellyfin takes it', async (t) => {
  const { JellyfinProvider } = await import('./JellyfinProvider.js')
  const provider = new JellyfinProvider('http://jf.test')
  const fetch = t.mock.method(provider, 'fetch', async () => ({}))
  await provider.deleteVirtualLibrary('key', { id: 'abc', name: 'AI Picks - Ann' })
  const [path, , options] = fetch.mock.calls[0].arguments as [string, string, RequestInit]
  assert.equal(path, '/Library/VirtualFolders?name=AI%20Picks%20-%20Ann&refreshLibrary=true')
  assert.equal(options.method, 'DELETE')
})
