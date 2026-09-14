import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOME_SECTION_SORTS, sanitizeHomeSectionsUpdate, sortOrderFor } from './settings.js'

test('a valid body becomes an update with no errors', () => {
  const { update, errors } = sanitizeHomeSectionsUpdate({
    enabled: true,
    sectionPosition: 2,
    recommendationsLimit: 15,
    sortBy: 'DateCreated',
    recommendationsName: '  For You  ',
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(update, {
    enabled: true,
    sectionPosition: 2,
    recommendationsLimit: 15,
    sortBy: 'DateCreated',
    recommendationsName: 'For You',
  })
})

test('absent fields are left alone', () => {
  assert.deepEqual(sanitizeHomeSectionsUpdate({}), { update: {}, errors: [] })
})

test('an invalid value is refused rather than clamped', () => {
  const { update, errors } = sanitizeHomeSectionsUpdate({
    enabled: 'yes',
    sectionPosition: -1,
    recommendationsLimit: 1000,
    sortBy: 'Rank',
    topPicksMoviesName: '   ',
  })
  assert.deepEqual(update, {})
  assert.equal(errors.length, 5)
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
