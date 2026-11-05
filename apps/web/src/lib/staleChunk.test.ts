import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimChunkReload,
  holdChunkReload,
  installChunkReload,
  isChunkReloadPending,
  keepPageOnChunkFailure,
} from './staleChunk'

function memoryStore() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  }
}

test('a build reloads once, so a chunk that keeps failing cannot loop', () => {
  const store = memoryStore()
  assert.equal(claimChunkReload(store, 'index-a.js'), true)
  assert.equal(claimChunkReload(store, 'index-a.js'), false)
  assert.equal(claimChunkReload(store, 'index-a.js'), false)
})

test('the next deploy gets its own attempt, and two builds flapping still stops', () => {
  const store = memoryStore()
  assert.equal(claimChunkReload(store, 'index-a.js'), true)
  assert.equal(claimChunkReload(store, 'index-b.js'), true)
  assert.equal(claimChunkReload(store, 'index-a.js'), false)
})

test('a store that cannot remember never reloads', () => {
  const refuses = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  const unreadable = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {},
  }
  assert.equal(claimChunkReload(refuses, 'index-a.js'), false)
  assert.equal(claimChunkReload(unreadable, 'index-a.js'), false)
})

test('a failure over open work leaves the page alone and spends no attempt; the next one reloads', async () => {
  const handlers: Array<() => void> = []
  let reloads = 0
  const fakeWindow = {
    addEventListener: (_type: string, handler: () => void) => void handlers.push(handler),
    sessionStorage: memoryStore(),
    location: { reload: () => void (reloads += 1) },
  }
  ;(globalThis as unknown as { window: unknown }).window = fakeWindow
  installChunkReload('index-held.js')
  const chunkFails = () => handlers.forEach((handler) => handler())

  // The chat open beside the pages: nothing reloads, and releasing twice is safe.
  const release = holdChunkReload()
  chunkFails()
  assert.equal(reloads, 0)
  release()
  release()

  // A dialog's own import: held while it runs, as Vite raises its event first.
  await assert.rejects(
    keepPageOnChunkFailure(async () => {
      chunkFails()
      throw new Error('chunk gone')
    })
  )
  assert.equal(reloads, 0)
  assert.equal(isChunkReloadPending(), false, 'so the boundary shows its message and Reload button')

  // Nothing held, and the attempt was still there to use.
  chunkFails()
  assert.equal(reloads, 1)
  assert.equal(isChunkReloadPending(), true)
})
