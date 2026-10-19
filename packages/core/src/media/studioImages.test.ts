import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getStudios, pickStudioImage } from './studioImages.js'

test('a Thumb is preferred, a Primary taken when there is no Thumb', () => {
  assert.deepEqual(pickStudioImage({ Primary: 'p1', Thumb: 't1' }), { type: 'Thumb', tag: 't1' })
  assert.deepEqual(pickStudioImage({ Primary: 'p1' }), { type: 'Primary', tag: 'p1' })
})

test('other image types and empty tags are not a studio logo', () => {
  assert.equal(pickStudioImage({ Backdrop: 'b1', Logo: 'l1' }), null)
  assert.equal(pickStudioImage({ Thumb: '' }), null)
  assert.equal(pickStudioImage({}), null)
  assert.equal(pickStudioImage(undefined), null)
  assert.equal(pickStudioImage(null), null)
})

test('getStudios asks /Studios once for both image types and keeps only named items', async () => {
  const asked: string[] = []
  const source = {
    async fetch<T>(endpoint: string, apiKey: string): Promise<T> {
      asked.push(`${apiKey} ${endpoint}`)
      return {
        Items: [
          { Id: '1', Name: 'HBO', ImageTags: { Thumb: 't1' } },
          { Id: '2', Name: 'Calamity Films', ImageTags: { Primary: 'p2' } },
          { Id: '3', Name: 'Doozer' },
          { Id: '4' },
          { Name: 'No id' },
        ],
      } as T
    },
  }
  const studios = await getStudios(source, 'key')
  assert.equal(asked.length, 1)
  assert.match(asked[0], /^key \/Studios\?/)
  assert.match(asked[0], /EnableImageTypes=Thumb%2CPrimary/)
  assert.match(asked[0], /Fields=ImageTags/)
  assert.deepEqual(studios, [
    { id: '1', name: 'HBO', image: { type: 'Thumb', tag: 't1' } },
    { id: '2', name: 'Calamity Films', image: { type: 'Primary', tag: 'p2' } },
    { id: '3', name: 'Doozer', image: null },
  ])
})

test('getStudios treats a body with no Items as an empty list', async () => {
  const source = { fetch: async <T,>() => ({}) as T }
  assert.deepEqual(await getStudios(source, 'key'), [])
})
