/**
 * Aperture tags items on the media server to back managed home-screen rows, and
 * both mappers copy `item.Tags` into the columns the canonical text embeds as
 * "Themes". If our own tag survived the sync, every title recommended to one
 * viewer would carry the same token into its vector and drift toward the rest —
 * a feedback loop that nothing downstream could see.
 *
 * These pin the mappers rather than just the predicate: the predicate is
 * trivial, and the failure is a mapper that forgets to call it.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MANAGED_TAG_PREFIX, isManagedTag, withoutManagedTags } from './managedTags.js'
import { mapJellyfinItemToMovie, mapJellyfinItemToSeries } from './jellyfin/mappers.js'
import { mapEmbyItemToMovie, mapEmbyItemToSeries } from './emby/mappers.js'
import type { JellyfinItem } from './jellyfin/types.js'
import type { EmbyItem, EmbySeries } from './emby/types.js'

const TAGS = ['heist', `${MANAGED_TAG_PREFIX}recs-3f9a1c`, 'Aperture:Top-Picks-Movies', 'time travel']
const EXPECTED = ['heist', 'time travel']

describe('isManagedTag', () => {
  test('matches the prefix case-insensitively and ignores surrounding space', () => {
    assert.equal(isManagedTag('aperture:recs-abc'), true)
    assert.equal(isManagedTag('  APERTURE:top-picks-series'), true)
  })

  test('leaves a tag that merely mentions aperture alone', () => {
    assert.equal(isManagedTag('aperture'), false)
    assert.equal(isManagedTag('aperture science'), false)
    assert.equal(isManagedTag('wide aperture:lens'), false)
  })
})

describe('withoutManagedTags', () => {
  test('drops managed tags and keeps order', () => {
    assert.deepEqual(withoutManagedTags(TAGS), EXPECTED)
  })

  test('absent tags become an empty list, never undefined', () => {
    assert.deepEqual(withoutManagedTags(undefined), [])
    assert.deepEqual(withoutManagedTags(null), [])
  })
})

describe('mappers', () => {
  test('Emby movie', () => {
    const item = { Id: '1', Name: 'Heat', Tags: [...TAGS] } as EmbyItem
    assert.deepEqual(mapEmbyItemToMovie(item, 'http://x').tags, EXPECTED)
  })

  test('Emby series', () => {
    const item = { Id: '1', Name: 'Dark', Tags: [...TAGS] } as EmbySeries
    assert.deepEqual(mapEmbyItemToSeries(item, 'http://x').tags, EXPECTED)
  })

  test('Jellyfin movie', () => {
    const item = { Id: '1', Name: 'Heat', Tags: [...TAGS] } as JellyfinItem
    assert.deepEqual(mapJellyfinItemToMovie(item, 'http://x').tags, EXPECTED)
  })

  test('Jellyfin series', () => {
    const item = { Id: '1', Name: 'Dark', Tags: [...TAGS] } as JellyfinItem
    assert.deepEqual(mapJellyfinItemToSeries(item, 'http://x').tags, EXPECTED)
  })
})
