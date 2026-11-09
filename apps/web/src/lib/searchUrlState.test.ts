import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adoptsAddress, readSearchState, searchStateParams, viewAllPath } from './searchUrlState'

const read = (search: string) => readSearchState(new URLSearchParams(search))

test('an empty address is a search with no filters', () => {
  assert.deepEqual(read(''), {
    q: '',
    type: 'all',
    genre: '',
    collection: '',
    network: '',
    minRtScore: 0,
    semantic: false,
    yearMin: null,
    yearMax: null,
  })
})

test('every filter survives a write and a read', () => {
  const state = {
    q: 'heat & dust',
    type: 'series' as const,
    genre: 'Drama',
    collection: 'Alien',
    network: 'HBO',
    minRtScore: 70,
    semantic: true,
    yearMin: 2010,
    yearMax: 2015,
  }
  assert.deepEqual(readSearchState(searchStateParams(state)), state)
})

test('unreadable values fall back to no filter', () => {
  const state = read('type=foo&minRtScore=abc&yearMin=19x0&yearMax=12')
  assert.equal(state.type, 'all')
  assert.equal(state.minRtScore, 0)
  assert.equal(state.yearMin, null)
  assert.equal(state.yearMax, null)
  assert.equal(read('minRtScore=150').minRtScore, 0)
  assert.equal(read('minRtScore=-10').minRtScore, 0)
})

test('crossed years are put the right way round', () => {
  const state = read('yearMin=2015&yearMax=2010')
  assert.equal(state.yearMin, 2010)
  assert.equal(state.yearMax, 2015)
})

test('the written address holds only what is set, in one order', () => {
  assert.equal(searchStateParams(read('semantic=false&type=all&q=x')).toString(), 'q=x')
  assert.equal(
    searchStateParams(read('semantic=true&yearMax=2000&q=x&type=movie')).toString(),
    'q=x&type=movie&yearMax=2000&semantic=true'
  )
})

test("the page's own replace writes are never taken back over", () => {
  assert.equal(adoptsAddress('REPLACE'), false)
  assert.equal(adoptsAddress('PUSH'), true)
  assert.equal(adoptsAddress('POP'), true)
})

test('view all from elsewhere carries only the text', () => {
  assert.equal(viewAllPath('the thing', { pathname: '/movies', search: '?type=series' }), '/search?q=the+thing')
})

test('view all from the Search page keeps its filters and replaces the text', () => {
  assert.equal(
    viewAllPath('noir', { pathname: '/search', search: '?q=old&type=series&semantic=true&yearMin=1940' }),
    '/search?q=noir&type=series&yearMin=1940&semantic=true'
  )
})
