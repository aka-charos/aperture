import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tmdbCreditsByTitle, tmdbPersonAgreesWithLibrary, tmdbTitleKey } from './personTmdbCredits.js'
import { readTmdbPersonDetails, tmdbDate } from '../tmdb/personDetails.js'
import { MAX_STORED_ACTORS } from '../media/castLimits.js'
import { mapEmbyActors } from '../media/emby/mapperHelpers.js'

describe('tmdbCreditsByTitle', () => {
  it('merges a title credited as cast and crew into one entry with every role', () => {
    const byTitle = tmdbCreditsByTitle({
      cast: [{ id: 1895, media_type: 'movie', character: 'Nee Alavar' }],
      crew: [
        { id: 1895, media_type: 'movie', job: 'Director' },
        { id: 1895, media_type: 'movie', job: 'Screenplay' },
      ],
    })
    assert.deepEqual(byTitle.get('movie:1895'), {
      media: 'movie',
      tmdbId: '1895',
      roles: ['actor', 'director', 'writer'],
      character: 'Nee Alavar',
    })
  })

  it('keeps a movie and a show with the same TMDb id apart', () => {
    const byTitle = tmdbCreditsByTitle({
      cast: [
        { id: 77, media_type: 'movie' },
        { id: 77, media_type: 'tv', character: 'Helen' },
      ],
    })
    assert.equal(byTitle.size, 2)
    assert.equal(byTitle.get('tv:77')?.character, 'Helen')
    assert.equal(byTitle.get('movie:77')?.character, null)
  })

  it('leaves out adult titles and entries without a media type', () => {
    const byTitle = tmdbCreditsByTitle({
      cast: [
        { id: 1, media_type: 'movie', adult: true },
        { id: 2 },
      ],
    })
    assert.equal(byTitle.size, 0)
  })

  it('takes the character from a cast credit only, and the first one TMDb lists', () => {
    const byTitle = tmdbCreditsByTitle({
      cast: [
        { id: 5, media_type: 'tv', character: '  ' },
        { id: 5, media_type: 'tv', character: 'Second' },
      ],
      crew: [{ id: 9, media_type: 'movie', job: 'Producer', character: 'not a role' }],
    })
    // The duplicate cast row is dropped by the flattener: one character per title.
    assert.equal(byTitle.get('tv:5')?.character, null)
    assert.equal(byTitle.get('movie:9')?.character, null)
  })
})

describe('tmdbPersonAgreesWithLibrary', () => {
  const byTitle = tmdbCreditsByTitle({
    cast: [
      { id: 1894, media_type: 'movie' },
      { id: 75516, media_type: 'tv' },
    ],
  })

  it('agrees when one name-matched title is among TMDb credits', () => {
    assert.equal(
      tmdbPersonAgreesWithLibrary(byTitle, [
        { media: 'movie', tmdbId: '999' },
        { media: 'movie', tmdbId: '1894' },
      ]),
      true
    )
  })

  it('compares the media type too', () => {
    assert.equal(tmdbPersonAgreesWithLibrary(byTitle, [{ media: 'tv', tmdbId: '1894' }]), false)
  })

  it('does not agree on titles without a TMDb id, or with nothing to compare', () => {
    assert.equal(
      tmdbPersonAgreesWithLibrary(byTitle, [
        { media: 'movie', tmdbId: null },
        { media: 'movie', tmdbId: '  ' },
      ]),
      false
    )
    assert.equal(tmdbPersonAgreesWithLibrary(byTitle, []), false)
  })

  it('trims stored ids before comparing', () => {
    assert.equal(tmdbTitleKey('tv', ' 75516 '), 'tv:75516')
    assert.equal(tmdbPersonAgreesWithLibrary(byTitle, [{ media: 'tv', tmdbId: '75516 ' }]), true)
  })
})

describe('readTmdbPersonDetails', () => {
  it('reads biography, dates and birthplace', () => {
    assert.deepEqual(
      readTmdbPersonDetails({
        biography: ' Rena Owen is a New Zealand actress. ',
        birthday: '1962-04-22',
        deathday: null,
        place_of_birth: 'Bay of Islands, New Zealand',
      }),
      {
        biography: 'Rena Owen is a New Zealand actress.',
        birthday: '1962-04-22',
        deathday: null,
        placeOfBirth: 'Bay of Islands, New Zealand',
      }
    )
  })

  it('turns empty strings into null', () => {
    assert.deepEqual(readTmdbPersonDetails({ biography: '', birthday: '', place_of_birth: ' ' }), {
      biography: null,
      birthday: null,
      deathday: null,
      placeOfBirth: null,
    })
  })

  it('accepts only real calendar dates in YYYY-MM-DD', () => {
    assert.equal(tmdbDate('1962-04-22'), '1962-04-22')
    assert.equal(tmdbDate('1962-02-30'), null)
    assert.equal(tmdbDate('1962'), null)
    assert.equal(tmdbDate('1962-4-2'), null)
    assert.equal(tmdbDate(undefined), null)
  })
})

describe('stored cast length', () => {
  it('keeps actors past the twentieth billed', () => {
    const people = Array.from({ length: 60 }, (_, i) => ({ Name: `Actor ${i + 1}`, Type: 'Actor' }))
    const actors = mapEmbyActors(people, 'http://emby')
    assert.equal(actors.length, 60)
    assert.equal(actors[39].name, 'Actor 40')
  })

  it('still bounds a pathological cast', () => {
    const people = Array.from({ length: MAX_STORED_ACTORS + 5 }, (_, i) => ({
      Name: `Actor ${i}`,
      Type: 'Actor',
    }))
    assert.equal(mapEmbyActors(people, 'http://emby').length, MAX_STORED_ACTORS)
  })
})
