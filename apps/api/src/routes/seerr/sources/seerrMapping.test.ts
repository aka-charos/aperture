/**
 * Pins the Seerr -> Aperture search mapping.
 *
 * Every case here is a failure that would be invisible on screen: a Request
 * button offered for something already on the server, a series filed as a
 * movie, or a whole result silently dropped.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mapSeerrSearchItem } from './seerrMapping.js'
import type { SeerrSearchItem } from '@aperture/core'

function movie(overrides: Partial<SeerrSearchItem> = {}): SeerrSearchItem {
  return {
    id: 550,
    mediaType: 'movie',
    title: 'Fight Club',
    releaseDate: '1999-10-15',
    ...overrides,
  } as SeerrSearchItem
}

test('a Seerr "tv" result becomes an Aperture "series" result', () => {
  const mapped = mapSeerrSearchItem({
    id: 1396,
    mediaType: 'tv',
    name: 'Breaking Bad',
    firstAirDate: '2008-01-20',
  } as SeerrSearchItem)

  assert.equal(mapped?.mediaType, 'series')
  assert.equal(mapped?.title, 'Breaking Bad')
  assert.equal(mapped?.year, 2008)
})

test('availability reads 4K as well as HD, so a 4K-only title is not offered again', () => {
  // HD unknown, 4K available: the user already has it.
  const mapped = mapSeerrSearchItem(
    movie({ mediaInfo: { id: 1, tmdbId: 550, status: 1, status4k: 5, mediaType: 'movie' } })
  )

  assert.equal(mapped?.availability, 'available')
})

test('a status arriving as a string is read, not discarded', () => {
  const mapped = mapSeerrSearchItem(
    movie({
      mediaInfo: {
        id: 1,
        tmdbId: 550,
        status: '5',
        mediaType: 'movie',
      } as unknown as SeerrSearchItem['mediaInfo'],
    })
  )

  assert.equal(mapped?.availability, 'available')
})

test('no mediaInfo means unknown and not requested, never a false positive', () => {
  const mapped = mapSeerrSearchItem(movie())

  assert.equal(mapped?.availability, 'unknown')
  assert.equal(mapped?.requested, false)
  assert.equal(mapped?.requestStatus, null)
})

test('a title in the download pipeline counts as requested', () => {
  const processing = mapSeerrSearchItem(
    movie({ mediaInfo: { id: 1, tmdbId: 550, status: 3, mediaType: 'movie' } })
  )
  assert.equal(processing?.requested, true)

  const pending = mapSeerrSearchItem(
    movie({ mediaInfo: { id: 1, tmdbId: 550, status: 2, mediaType: 'movie' } })
  )
  assert.equal(pending?.requested, true)
})

test('an existing request carries its status through', () => {
  const mapped = mapSeerrSearchItem(
    movie({
      mediaInfo: {
        id: 1,
        tmdbId: 550,
        status: 2,
        mediaType: 'movie',
        requests: [{ id: 9, status: 1 }],
      } as unknown as SeerrSearchItem['mediaInfo'],
    })
  )

  assert.equal(mapped?.requested, true)
  assert.equal(mapped?.requestStatus, 'pending')
})

test('a person keeps a few known-for titles for disambiguation and is never requestable', () => {
  const mapped = mapSeerrSearchItem({
    id: 287,
    mediaType: 'person',
    name: 'Brad Pitt',
    profilePath: '/brad.jpg',
    knownFor: [
      { id: 550, mediaType: 'movie', title: 'Fight Club' },
      { id: 807, mediaType: 'movie', title: 'Se7en' },
      { id: 16869, mediaType: 'movie', title: 'Inglourious Basterds' },
      { id: 4, mediaType: 'movie', title: 'A Fourth One' },
    ],
  } as SeerrSearchItem)

  assert.equal(mapped?.mediaType, 'person')
  assert.equal(mapped?.profilePath, '/brad.jpg')
  assert.equal(mapped?.requested, false)
  assert.deepEqual(mapped?.knownFor, ['Fight Club', 'Se7en', 'Inglourious Basterds'])
})

test('a result with no usable name is dropped rather than rendered blank', () => {
  assert.equal(mapSeerrSearchItem({ id: 1, mediaType: 'movie' } as SeerrSearchItem), null)
})

test('a missing or unparseable date yields a null year, never NaN', () => {
  assert.equal(mapSeerrSearchItem(movie({ releaseDate: undefined }))?.year, null)
  assert.equal(mapSeerrSearchItem(movie({ releaseDate: '' }))?.year, null)
})
