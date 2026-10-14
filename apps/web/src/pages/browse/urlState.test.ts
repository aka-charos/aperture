import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultMovieFilters, defaultSeriesFilters } from './constants.js'
import { readBrowseUrl, withLoadedRange, writeBrowseUrl, type MediaSnapshot } from './urlState.js'
import type { MovieFilters, SeriesFilters } from './components'

const RANGES = { year: { min: 1920, max: 2026 }, runtime: { min: 0, max: 240 }, seasons: { min: 1, max: 18 } }

function movies(over: Partial<MediaSnapshot<MovieFilters>> = {}): MediaSnapshot<MovieFilters> {
  return {
    search: '',
    genre: '',
    group: '',
    filters: { ...defaultMovieFilters, yearRange: [1920, 2026], runtimeRange: [0, 240] },
    sortBy: 'title',
    sortOrder: 'asc',
    ranges: RANGES,
    ...over,
  }
}

function series(over: Partial<MediaSnapshot<SeriesFilters>> = {}): MediaSnapshot<SeriesFilters> {
  return {
    search: '',
    genre: '',
    group: '',
    filters: { ...defaultSeriesFilters, yearRange: [1920, 2026], seasonsRange: [1, 18] },
    sortBy: 'title',
    sortOrder: 'asc',
    ranges: RANGES,
    ...over,
  }
}

const PEOPLE = { search: '', sortBy: 'credits' as const }

describe('writeBrowseUrl', () => {
  it('writes only the tab and the sort when nothing is selected', () => {
    assert.equal(
      writeBrowseUrl('movies', { movies: movies(), series: series(), people: PEOPLE }),
      'tab=movies&sortBy=title&sortOrder=asc'
    )
  })

  it("writes only the active tab's selection", () => {
    const query = writeBrowseUrl('series', {
      movies: movies({ genre: 'Drama' }),
      series: series({ genre: 'Crime', group: 'HBO' }),
      people: PEOPLE,
    })
    assert.match(query, /genre=Crime/)
    assert.match(query, /network=HBO/)
    assert.doesNotMatch(query, /Drama/)
  })

  it('writes a range end only when it is narrowed from the loaded extent', () => {
    const query = new URLSearchParams(
      writeBrowseUrl('movies', {
        movies: movies({ filters: { ...movies().filters, yearRange: [1990, 2026], communityRating: [6.5, 10] } }),
        series: series(),
        people: PEOPLE,
      })
    )
    assert.equal(query.get('minYear'), '1990')
    assert.equal(query.get('maxYear'), null)
    assert.equal(query.get('minRating'), '6.5')
    assert.equal(query.get('maxRating'), null)
  })

  it('leaves the defaults out: OR across countries, primary only, any watch status', () => {
    const query = writeBrowseUrl('movies', {
      movies: movies({ filters: { ...movies().filters, countries: ['Greece', 'Cyprus'] } }),
      series: series(),
      people: PEOPLE,
    })
    assert.match(query, /country=Greece&country=Cyprus/)
    assert.doesNotMatch(query, /countryMatch|secondary|watch=/)
  })
})

describe('readBrowseUrl', () => {
  it('a bare /browse reads as the movies tab with nothing selected and no sort', () => {
    const state = readBrowseUrl(new URLSearchParams(''))
    assert.equal(state.tab, null)
    assert.deepEqual(state.movies.filters, defaultMovieFilters)
    assert.equal(state.movies.sortBy, undefined)
  })

  it('round-trips a full movie selection', () => {
    const snapshot = movies({
      search: 'heat',
      genre: 'Crime',
      group: 'Alien Collection',
      filters: {
        ...movies().filters,
        yearRange: [1980, 1999],
        runtimeRange: [90, 240],
        communityRating: [7, 10],
        rtScore: [60, 100],
        metacritic: [0, 90],
        contentRatings: ['R', 'PG-13'],
        resolutions: ['4K'],
        countries: ['Greece', 'Spain'],
        countryMatch: 'all',
        includeSecondaryCountries: true,
        watchStatus: 'unwatched',
        minWatchers: 2,
        maxWatchers: 0,
      },
      sortBy: 'rating',
      sortOrder: 'desc',
    })
    const query = writeBrowseUrl('movies', { movies: snapshot, series: series(), people: PEOPLE })
    const state = readBrowseUrl(new URLSearchParams(query))
    assert.equal(state.movies.search, 'heat')
    assert.equal(state.movies.genre, 'Crime')
    assert.equal(state.movies.group, 'Alien Collection')
    assert.equal(state.movies.sortBy, 'rating')
    assert.equal(state.movies.sortOrder, 'desc')
    const f = state.movies.filters
    assert.deepEqual(f.yearRange, [1980, 1999])
    assert.deepEqual(f.runtimeRange, [90, defaultMovieFilters.runtimeRange[1]])
    assert.deepEqual(f.communityRating, [7, 10])
    assert.deepEqual(f.rtScore, [60, 100])
    assert.deepEqual(f.metacritic, [0, 90])
    assert.deepEqual(f.contentRatings, ['R', 'PG-13'])
    assert.deepEqual(f.resolutions, ['4K'])
    assert.deepEqual(f.countries, ['Greece', 'Spain'])
    assert.equal(f.countryMatch, 'all')
    assert.equal(f.includeSecondaryCountries, true)
    assert.equal(f.watchStatus, 'unwatched')
    assert.equal(f.minWatchers, 2)
    assert.equal(f.maxWatchers, 0)
    // Only the ends the URL named are pinned against the range load.
    assert.deepEqual(state.movies.pinned.yearRange, { min: true, max: true })
    assert.deepEqual(state.movies.pinned.runtimeRange, { min: true, max: false })
  })

  it('round-trips a series selection, status included', () => {
    const query = writeBrowseUrl('series', {
      movies: movies(),
      series: series({
        group: 'HBO',
        filters: { ...series().filters, status: ['Continuing', 'Ended'], seasonsRange: [1, 3] },
        sortBy: 'seasons',
        sortOrder: 'asc',
      }),
      people: PEOPLE,
    })
    const state = readBrowseUrl(new URLSearchParams(query))
    assert.equal(state.tab, 'series')
    assert.equal(state.series.group, 'HBO')
    assert.deepEqual(state.series.filters.status, ['Continuing', 'Ended'])
    assert.deepEqual(state.series.filters.seasonsRange, [defaultSeriesFilters.seasonsRange[0], 3])
    assert.equal(state.series.sortBy, 'seasons')
    // The movies tab does not borrow the series tab's parameters.
    assert.equal(state.movies.genre, '')
    assert.deepEqual(state.movies.filters, defaultMovieFilters)
  })

  it('round-trips the people tab', () => {
    const query = writeBrowseUrl('people', { movies: movies(), series: series(), people: { search: 'kubrick', sortBy: 'name' } })
    const state = readBrowseUrl(new URLSearchParams(query))
    assert.equal(state.tab, 'people')
    assert.equal(state.people.search, 'kubrick')
    assert.equal(state.people.sortBy, 'name')
  })

  it('ignores what it cannot show: unknown sorts, bad numbers, reversed ranges, unknown values', () => {
    const state = readBrowseUrl(
      new URLSearchParams(
        'sortBy=seasons&sortOrder=sideways&minYear=abc&minRating=9&maxRating=2&watch=maybe&countryMatch=some&minWatchers=-3'
      )
    )
    assert.equal(state.movies.sortBy, undefined) // seasons is a series sort
    assert.equal(state.movies.sortOrder, undefined)
    assert.deepEqual(state.movies.filters.yearRange, defaultMovieFilters.yearRange)
    assert.deepEqual(state.movies.filters.communityRating, defaultMovieFilters.communityRating)
    assert.equal(state.movies.filters.watchStatus, 'any')
    assert.equal(state.movies.filters.countryMatch, defaultMovieFilters.countryMatch)
    assert.equal(state.movies.filters.minWatchers, null)
  })
})

describe('withLoadedRange', () => {
  it('keeps the ends the URL set and takes the rest from the library', () => {
    assert.deepEqual(withLoadedRange([1990, 2026], [1920, 2025], { min: true, max: false }), [1990, 2025])
    assert.deepEqual(withLoadedRange([1990, 2000], [1920, 2025], { min: true, max: true }), [1990, 2000])
  })

  it('takes the whole loaded range when nothing was restored', () => {
    assert.deepEqual(withLoadedRange([1900, 2026], [1920, 2025], undefined), [1920, 2025])
  })
})
