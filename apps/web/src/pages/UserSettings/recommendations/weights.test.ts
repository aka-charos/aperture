import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FRANCHISE_SCALE, GENRE_SCALE, orderWithNewFirst, summarizeWeights, weightTone } from './weights.js'

describe('weightTone', () => {
  it('keeps the thresholds each list used before they were shared', () => {
    // Genres: above 1.3 boosted, below 0.7 less. Franchises: above 0.3, below -0.3.
    assert.equal(weightTone(1.31, GENRE_SCALE), 'up')
    assert.equal(weightTone(1.3, GENRE_SCALE), 'neutral')
    assert.equal(weightTone(0.7, GENRE_SCALE), 'neutral')
    assert.equal(weightTone(0.69, GENRE_SCALE), 'down')
    assert.equal(weightTone(0.31, FRANCHISE_SCALE), 'up')
    assert.equal(weightTone(-0.31, FRANCHISE_SCALE), 'down')
    assert.equal(weightTone(0, FRANCHISE_SCALE), 'neutral')
  })
})

describe('summarizeWeights', () => {
  const genres = [
    { name: 'Drama', w: 1.4 },
    { name: 'Horror', w: 0.2 },
    { name: 'Comedy', w: 1 },
    { name: 'Action', w: 2 },
    { name: 'Romance', w: 0.6 },
  ]

  it('lists each lean strongest first and leaves neutral out', () => {
    const { up, down } = summarizeWeights(genres, GENRE_SCALE, (g) => g.name, (g) => g.w)
    assert.deepEqual(up, ['Action', 'Drama'])
    assert.deepEqual(down, ['Horror', 'Romance'])
  })

  it('reports nothing for an untouched list', () => {
    const flat = genres.map((g) => ({ ...g, w: 1 }))
    assert.deepEqual(summarizeWeights(flat, GENRE_SCALE, (g) => g.name, (g) => g.w), { up: [], down: [] })
  })
})

describe('orderWithNewFirst', () => {
  it('puts new entries on top and keeps both groups alphabetical', () => {
    const names = ['Dune', 'Alien', 'Mad Max', 'Bourne']
    const ordered = orderWithNewFirst(names, ['Mad Max', 'Bourne'], (n) => n)
    assert.deepEqual(ordered, ['Bourne', 'Mad Max', 'Alien', 'Dune'])
  })

  it('does not reorder the input it was given', () => {
    const names = ['b', 'a']
    orderWithNewFirst(names, [], (n) => n)
    assert.deepEqual(names, ['b', 'a'])
  })
})
