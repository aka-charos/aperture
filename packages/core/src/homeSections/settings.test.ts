import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOME_SECTION_SORTS, sanitizeHomeSectionsUpdate, sortOrderFor } from './settings.js'

test('a valid body becomes an update with no errors', () => {
  const { update, errors } = sanitizeHomeSectionsUpdate({
    enabled: true,
    recommendationsLimit: 15,
    sortBy: 'DateCreated',
    recommendationsMoviesName: '  Films for You  ',
    placements: {
      'recs-movies': { mode: 'after', anchor: { id: 'smalllibrarytiles', type: 'userviews', name: 'My Media' } },
      playlists: { mode: 'position', position: 3 },
    },
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(update, {
    enabled: true,
    recommendationsLimit: 15,
    sortBy: 'DateCreated',
    recommendationsMoviesName: 'Films for You',
    placements: {
      'recs-movies': {
        mode: 'after',
        position: 0,
        anchor: { id: 'smalllibrarytiles', type: 'userviews', name: 'My Media' },
        fallbackMode: 'bottom',
        fallbackPosition: 0,
      },
      playlists: { mode: 'position', position: 3, anchor: null, fallbackMode: 'bottom', fallbackPosition: 0 },
    },
  })
})

test('absent fields are left alone', () => {
  assert.deepEqual(sanitizeHomeSectionsUpdate({}), { update: {}, errors: [] })
})

test('an invalid value is refused rather than clamped', () => {
  const { update, errors } = sanitizeHomeSectionsUpdate({
    enabled: 'yes',
    recommendationsLimit: 1000,
    sortBy: 'Rank',
    topPicksMoviesName: '   ',
    placements: { 'recs-movies': { mode: 'after' }, sideways: { mode: 'top' } },
  })
  assert.deepEqual(update, {})
  assert.equal(errors.length, 6)
})

test('a non-object body is an error', () => {
  assert.equal(sanitizeHomeSectionsUpdate(null).errors.length, 1)
  assert.equal(sanitizeHomeSectionsUpdate('enabled').errors.length, 1)
})

test('there is no rank sort, because a tag carries no order', () => {
  assert.equal((HOME_SECTION_SORTS as readonly string[]).includes('Rank'), false)
})

test('each sort field has one direction', () => {
  assert.equal(sortOrderFor('SortName'), 'Ascending')
  assert.equal(sortOrderFor('Random'), 'Ascending')
  assert.equal(sortOrderFor('DateCreated'), 'Descending')
  assert.equal(sortOrderFor('CommunityRating'), 'Descending')
})
