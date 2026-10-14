import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LIST_MEMORY_TTL_MS, rememberList, snapshotMatches, takeList, type ListSnapshot } from './listMemory.js'

function snapshot(over: Partial<ListSnapshot<string>> = {}): ListSnapshot<string> {
  return { key: 'sortBy=title', items: ['a', 'b'], page: 3, total: 90, hasMore: true, scrollY: 1800, savedAt: 1_000, ...over }
}

describe('snapshotMatches', () => {
  it('matches the same selection inside the window', () => {
    assert.equal(snapshotMatches(snapshot(), 'sortBy=title', 1_000 + LIST_MEMORY_TTL_MS), true)
  })

  it('refuses a different selection, an old memory, or an empty list', () => {
    assert.equal(snapshotMatches(snapshot(), 'sortBy=rating', 1_000), false)
    assert.equal(snapshotMatches(snapshot(), 'sortBy=title', 1_001 + LIST_MEMORY_TTL_MS), false)
    assert.equal(snapshotMatches(snapshot({ items: [] }), 'sortBy=title', 1_000), false)
    assert.equal(snapshotMatches(undefined, 'sortBy=title', 1_000), false)
  })
})

describe('takeList', () => {
  it('hands a matching list back once, then forgets it', () => {
    rememberList('movies', snapshot())
    assert.equal(takeList('movies', 'sortBy=title', 1_000)?.scrollY, 1800)
    assert.equal(takeList('movies', 'sortBy=title', 1_000), null)
  })

  it('forgets a list that does not match, so a stale one cannot surface later', () => {
    rememberList('series', snapshot())
    assert.equal(takeList('series', 'sortBy=rating', 1_000), null)
    assert.equal(takeList('series', 'sortBy=title', 1_000), null)
  })

  it('keeps one memory per tab', () => {
    rememberList('movies', snapshot({ scrollY: 1 }))
    rememberList('series', snapshot({ scrollY: 2 }))
    assert.equal(takeList('series', 'sortBy=title', 1_000)?.scrollY, 2)
    assert.equal(takeList('movies', 'sortBy=title', 1_000)?.scrollY, 1)
  })
})
