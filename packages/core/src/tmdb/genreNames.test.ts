import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairGenreNames } from './genreNames.js'

test('pairs English and localized names by id', () => {
  const names = pairGenreNames([
    {
      english: [
        { id: 18, name: 'Drama' },
        { id: 80, name: 'Crime' },
      ],
      localized: [
        { id: 80, name: 'Έγκλημα' },
        { id: 18, name: 'Δράμα' },
      ],
    },
  ])
  assert.deepEqual(names, { Drama: 'Δράμα', Crime: 'Έγκλημα' })
})

test('skips missing, empty and untranslated names', () => {
  const names = pairGenreNames([
    {
      english: [
        { id: 1, name: 'Western' },
        { id: 2, name: 'Music' },
        { id: 3, name: 'News' },
      ],
      localized: [
        { id: 1, name: 'Western' },
        { id: 2, name: '  ' },
      ],
    },
  ])
  assert.deepEqual(names, {})
})

test('movie and TV lists merge, the first pairing of a name wins', () => {
  const names = pairGenreNames([
    { english: [{ id: 18, name: 'Drama' }], localized: [{ id: 18, name: 'Δράμα' }] },
    {
      english: [
        { id: 18, name: 'Drama' },
        { id: 10765, name: 'Sci-Fi & Fantasy' },
      ],
      localized: [
        { id: 18, name: 'Άλλο' },
        { id: 10765, name: 'Επιστ. Φαντασία & Φαντασία' },
      ],
    },
  ])
  assert.deepEqual(names, { Drama: 'Δράμα', 'Sci-Fi & Fantasy': 'Επιστ. Φαντασία & Φαντασία' })
})
