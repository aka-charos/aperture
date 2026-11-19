import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TmdbTitleCredit } from '@aperture/core'
import {
  personCreditItem,
  personCreditStats,
  sortPersonCredits,
  tmdbIdsThatAddTitles,
  type ContentItem,
  type PersonCreditRow,
} from './personCredits.js'

const row = (over: Partial<PersonCreditRow> = {}): PersonCreditRow => ({
  id: 'id-1',
  tmdb_id: '1895',
  title: 'Star Wars: Episode III',
  year: 2005,
  poster_url: null,
  backdrop_url: null,
  genres: null,
  community_rating: null,
  is_actor: false,
  is_director: false,
  is_writer: false,
  is_creator: false,
  role: null,
  ...over,
})

const credit = (over: Partial<TmdbTitleCredit> = {}): TmdbTitleCredit => ({
  media: 'movie',
  tmdbId: '1895',
  roles: ['actor'],
  character: 'Nee Alavar',
  addsTitle: true,
  ...over,
})

const item = (title: string, year: number | null): ContentItem => ({
  id: title,
  title,
  year,
  posterUrl: null,
  backdropUrl: null,
  genres: [],
  communityRating: null,
})

describe('personCreditItem', () => {
  it('takes TMDb roles and character for a title the name match missed', () => {
    const it1 = personCreditItem(row(), credit())
    assert.deepEqual(it1.credits, ['actor'])
    assert.equal(it1.role, 'Nee Alavar')
    assert.deepEqual(it1.genres, [])
  })

  it('unions media-server and TMDb roles, producer included, and drops other crew', () => {
    const it1 = personCreditItem(
      row({ is_director: true }),
      credit({ roles: ['director', 'producer', 'other'], character: null })
    )
    assert.deepEqual(it1.credits, ['director', 'producer'])
    assert.equal(it1.role, undefined)
  })

  it("prefers the media server's character over TMDb's", () => {
    assert.equal(personCreditItem(row({ is_actor: true, role: 'Taun We' }), credit()).role, 'Taun We')
  })

  it('uses only the media server without a TMDb credit', () => {
    assert.deepEqual(personCreditItem(row({ is_actor: true, is_writer: true })).credits, ['actor', 'writer'])
  })
})

describe('tmdbIdsThatAddTitles', () => {
  it('returns one media type, and only credits that may add a title', () => {
    const byTitle = new Map<string, TmdbTitleCredit>([
      ['movie:1', credit({ tmdbId: '1' })],
      ['movie:2', credit({ tmdbId: '2', addsTitle: false })],
      ['tv:3', credit({ media: 'tv', tmdbId: '3' })],
    ])
    assert.deepEqual(tmdbIdsThatAddTitles(byTitle, 'movie'), ['1'])
    assert.deepEqual(tmdbIdsThatAddTitles(byTitle, 'tv'), ['3'])
  })
})

describe('sortPersonCredits', () => {
  it('orders newest first, undated last, then by title, without changing its input', () => {
    const input = [item('B', 2001), item('Undated', null), item('A', 2001), item('New', 2015)]
    assert.deepEqual(
      sortPersonCredits(input).map((i) => i.title),
      ['New', 'A', 'B', 'Undated']
    )
    assert.equal(input[0].title, 'B')
  })
})

describe('personCreditStats', () => {
  it('counts titles by credit kind across both media types', () => {
    const movies = [
      { ...item('a', 1), credits: ['actor' as const] },
      { ...item('b', 2), credits: ['actor' as const, 'director' as const] },
      { ...item('c', 3), credits: ['producer' as const] },
    ]
    const series = [{ ...item('s', 4), credits: ['actor' as const, 'director' as const] }]
    assert.deepEqual(personCreditStats(movies, series), {
      totalMovies: 3,
      totalSeries: 1,
      asActor: 3,
      asDirector: 2,
    })
  })
})
