import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EmbyProviderBase } from './base.js'
import { createOrUpdateCollection, deleteCollection } from './collections.js'
import { deleteVirtualLibrary } from './libraries.js'

interface Call {
  endpoint: string
  method: string
  body?: Record<string, unknown>
}

function fakeProvider(items: Record<string, Record<string, unknown>>, members: string[]) {
  const calls: Call[] = []
  const provider = {
    baseUrl: 'http://emby:8096',
    async fetch(endpoint: string, _apiKey: string, options: RequestInit = {}) {
      const method = options.method ?? 'GET'
      calls.push({
        endpoint,
        method,
        body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
      })
      if (endpoint.startsWith('/Items?ParentId=c1')) return { Items: members.map((Id) => ({ Id })) }
      if (endpoint.startsWith('/Items?IncludeItemTypes=BoxSet')) return { Items: [{ Id: 'c1', Name: 'Top Picks' }] }
      if (endpoint.startsWith('/Collections/c1/Items')) return null
      if (endpoint === '/Items/c1' && method === 'DELETE') return null
      const item = endpoint.match(/^\/Items\/(\w+)$/)
      if (item && method === 'GET') return structuredClone(items[item[1]])
      if (item && method === 'POST') return null
      throw new Error(`unexpected ${method} ${endpoint}`)
    },
  }
  return { provider: provider as unknown as EmbyProviderBase, calls }
}

const dropped = () => ({
  m1: { Id: 'm1', Name: 'Heat' },
  m3: { Id: 'm3', Name: 'Collateral', ForcedSortName: '02 - Collateral', LockedFields: ['SortName'] },
})
const posted = (calls: Call[], id: string) =>
  calls.find((c) => c.method === 'POST' && c.endpoint === `/Items/${id}`)?.body

test('Emby: an item that leaves a ranked collection loses the prefix', async () => {
  const { provider, calls } = fakeProvider(dropped(), ['m1', 'm3'])
  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1'])

  assert.equal(posted(calls, 'm3')?.ForcedSortName, undefined)
  assert.deepEqual(posted(calls, 'm3')?.LockedFields, [])
  assert.equal(posted(calls, 'm1')?.ForcedSortName, '01 - Heat')
})

test('Emby: a rankAndPin:false collection never clears a prefix', async () => {
  const { provider, calls } = fakeProvider(dropped(), ['m1', 'm3'])
  await createOrUpdateCollection(provider, 'key', 'Top Picks', ['m1'], { rankAndPin: false })

  assert.equal(calls.some((c) => c.method === 'POST' && c.endpoint.startsWith('/Items/')), false)
})

test('Emby: delete clears members only when asked to', async () => {
  const withOption = fakeProvider(dropped(), ['m1', 'm3'])
  await deleteCollection(withOption.provider, 'key', 'c1', { clearRankSortNames: true })
  assert.equal(posted(withOption.calls, 'm3')?.ForcedSortName, undefined)

  const plain = fakeProvider(dropped(), ['m1', 'm3'])
  await deleteCollection(plain.provider, 'key', 'c1')
  assert.deepEqual(plain.calls.map((c) => `${c.method} ${c.endpoint}`), ['DELETE /Items/c1'])
})

test('Emby: a library is removed by its id, through the documented POST', async () => {
  const calls: Array<{ endpoint: string; method?: string; body?: unknown }> = []
  const provider = {
    async fetch(endpoint: string, _apiKey: string, options: RequestInit = {}) {
      calls.push({ endpoint, method: options.method, body: JSON.parse(String(options.body)) })
      return {}
    },
  } as unknown as EmbyProviderBase
  await deleteVirtualLibrary(provider, 'key', '15529')
  assert.deepEqual(calls, [
    { endpoint: '/Library/VirtualFolders/Delete', method: 'POST', body: { Id: '15529', RefreshLibrary: true } },
  ])
  // No id, no call: a guess could remove the wrong library.
  await assert.rejects(deleteVirtualLibrary(provider, 'key', ''), /id is required/)
  assert.equal(calls.length, 1)
})
