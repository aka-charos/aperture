/**
 * The media server is where the mess came from.
 *
 * Jellyfin and Emby both expose `ProductionLocations`, which is not a
 * vocabulary — it is whatever the server's metadata scraper wrote into the
 * NFO. In one real library that produced "Ελλάδα" for 254 titles while
 * "Greece" sat separately at 22, bare codes like "GR" and "IT", and entire
 * comma-joined lists stored as a single string.
 *
 * These pin the mappers rather than the normaliser — the normaliser has its
 * own tests. What matters here is that both providers actually call it, on
 * movies and on series alike, so a library sync cannot re-dirty a column
 * after it has been cleaned.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mapJellyfinItemToMovie, mapJellyfinItemToSeries } from './jellyfin/mappers.js'
import { mapEmbyItemToMovie, mapEmbyItemToSeries } from './emby/mappers.js'
import type { JellyfinItem } from './jellyfin/types.js'
import type { EmbyItem, EmbySeries } from './emby/types.js'

const LOCATIONS = ['Ελλάδα', 'GR', 'United States of America', 'USA']
const EXPECTED = ['Greece', 'United States']

function jellyfinItem(): JellyfinItem {
  return { Id: '1', Name: 'Dogtooth', ProductionLocations: [...LOCATIONS] } as JellyfinItem
}

function embyItem(): EmbyItem {
  return { Id: '1', Name: 'Dogtooth', ProductionLocations: [...LOCATIONS] } as EmbyItem
}

describe('Jellyfin', () => {
  test('a movie normalises its production locations', () => {
    assert.deepEqual(mapJellyfinItemToMovie(jellyfinItem(), 'http://x').productionCountries, EXPECTED)
  })

  test('a series normalises its production locations', () => {
    assert.deepEqual(mapJellyfinItemToSeries(jellyfinItem(), 'http://x').productionCountries, EXPECTED)
  })

  test('an item with no locations gets an empty list, not undefined', () => {
    const bare = { Id: '1', Name: 'Dogtooth' } as JellyfinItem
    assert.deepEqual(mapJellyfinItemToMovie(bare, 'http://x').productionCountries, [])
  })
})

describe('Emby', () => {
  test('a movie normalises its production locations', () => {
    assert.deepEqual(mapEmbyItemToMovie(embyItem(), 'http://x').productionCountries, EXPECTED)
  })

  test('a series normalises its production locations', () => {
    const series = embyItem() as EmbySeries
    assert.deepEqual(mapEmbyItemToSeries(series, 'http://x').productionCountries, EXPECTED)
  })
})

describe('the shapes that made this necessary', () => {
  test('a whole co-production list stored as one location comes apart', () => {
    const item = {
      Id: '1',
      Name: 'x',
      ProductionLocations: ['France, Belgium, Canada, United Kingdom, Latvia, United States'],
    } as JellyfinItem
    assert.deepEqual(mapJellyfinItemToMovie(item, 'http://x').productionCountries, [
      'France',
      'Belgium',
      'Canada',
      'United Kingdom',
      'Latvia',
      'United States',
    ])
  })

  test('a location we do not recognise still reaches the database', () => {
    const item = { Id: '1', Name: 'x', ProductionLocations: ['Wakanda'] } as JellyfinItem
    assert.deepEqual(mapJellyfinItemToMovie(item, 'http://x').productionCountries, ['Wakanda'])
  })
})
