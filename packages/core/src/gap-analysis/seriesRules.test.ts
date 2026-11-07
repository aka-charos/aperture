import test from 'node:test'
import assert from 'node:assert/strict'
import {
  airedEpisodes,
  compareShowSeasons,
  decideSeasonStanding,
  decideSeriesGapShow,
  readRequestedSeasons,
  seasonIsRequested,
  seasonsStillToRequest,
  showNetworks,
  type StoredSeason,
  type TmdbSeason,
} from './seriesRules.js'

const NOW = new Date('2026-06-15T12:00:00Z')

function season(n: number, episodes: number, airDate: string | null = '2020-01-01'): TmdbSeason {
  return { season_number: n, episode_count: episodes, air_date: airDate }
}

const held = (entries: [number, number][]) => new Map(entries)

test('an earlier season has fully aired; an airing one stops at the last episode', () => {
  const last = { season_number: 3, episode_number: 4 }
  assert.equal(airedEpisodes(season(2, 10), last, NOW), 10)
  assert.equal(airedEpisodes(season(3, 10), last, NOW), 4)
  assert.equal(airedEpisodes(season(4, 10), last, NOW), 0)
})

test('a season not yet premiered, undated or empty has aired nothing', () => {
  assert.equal(airedEpisodes(season(1, 10, '2026-12-01'), null, NOW), 0)
  assert.equal(airedEpisodes(season(1, 10, null), null, NOW), 0)
  assert.equal(airedEpisodes(season(1, 0), null, NOW), 0)
})

test('with no last episode reported, a dated season counts whole', () => {
  assert.equal(airedEpisodes(season(1, 8), null, NOW), 8)
})

test('a special as the latest episode leaves the regular seasons aired', () => {
  const special = { season_number: 0, episode_number: 3 }
  assert.equal(airedEpisodes(season(1, 10), special, NOW), 10)
  assert.equal(airedEpisodes(season(5, 8), special, NOW), 8)
  assert.equal(airedEpisodes(season(6, 8, '2026-12-01'), special, NOW), 0, 'its date still counts')
})

test('a season before the last episode has aired even with no date', () => {
  const last = { season_number: 4, episode_number: 2 }
  assert.equal(airedEpisodes(season(2, 13, null), last, NOW), 13)
  assert.equal(airedEpisodes(season(4, 13, null), last, NOW), 0, 'the airing season still needs its date')
})

test('a last episode numbered past the season never overstates it', () => {
  // Some shows number episodes across seasons, so episode 30 can sit in a 24-episode season.
  assert.equal(airedEpisodes(season(2, 24), { season_number: 2, episode_number: 30 }, NOW), 24)
})

test('seasons read as complete, partial or missing, and specials stay out', () => {
  const { seasons, numberingDiffers } = compareShowSeasons({
    seasons: [season(0, 5), season(1, 10), season(2, 10), season(3, 10)],
    held: held([
      [0, 5],
      [1, 10],
      [2, 6],
    ]),
    now: NOW,
  })
  assert.deepEqual(
    seasons.map((s) => [s.seasonNumber, s.holding, s.heldEpisodes, s.airedEpisodes]),
    [
      [1, 'complete', 10, 10],
      [2, 'partial', 6, 10],
      [3, 'missing', 0, 10],
    ]
  )
  assert.equal(numberingDiffers, false)
})

test('an unaired season is not a gap', () => {
  const { seasons } = compareShowSeasons({
    seasons: [season(1, 10), season(2, 10, '2027-01-01')],
    lastEpisode: { season_number: 1, episode_number: 10 },
    held: held([[1, 10]]),
    now: NOW,
  })
  assert.deepEqual(seasons.map((s) => s.seasonNumber), [1])
  assert.equal(seasons[0].holding, 'complete')
})

test('the part of an airing season that has aired is all it owes', () => {
  const { seasons } = compareShowSeasons({
    seasons: [season(1, 10)],
    lastEpisode: { season_number: 1, episode_number: 4 },
    held: held([[1, 4]]),
    now: NOW,
  })
  assert.equal(seasons[0].holding, 'complete')
})

test('a library season TMDb does not list doubts the gaps', () => {
  // Library numbered by year, TMDb by season.
  const { numberingDiffers } = compareShowSeasons({
    seasons: [season(1, 10), season(2, 10)],
    held: held([[2019, 10], [2020, 10]]),
    now: NOW,
  })
  assert.equal(numberingDiffers, true)
})

test('a library season fuller than TMDb says doubts the gaps', () => {
  // One long library season against two TMDb seasons: season 2 only looks missing.
  const { numberingDiffers } = compareShowSeasons({
    seasons: [season(1, 25), season(2, 25)],
    held: held([[1, 50]]),
    now: NOW,
  })
  assert.equal(numberingDiffers, true)
})

test('odd numbering is no finding when nothing is missing', () => {
  const { numberingDiffers } = compareShowSeasons({
    seasons: [season(1, 10)],
    held: held([[1, 11], [2, 3]]),
    now: NOW,
  })
  assert.equal(numberingDiffers, false)
})

test('a show TMDb has no seasons for reports nothing', () => {
  const { seasons, numberingDiffers } = compareShowSeasons({ seasons: [], held: held([]), now: NOW })
  assert.deepEqual(seasons, [])
  assert.equal(numberingDiffers, false)
})

test('networks are TMDb first, all of them, and the library only as a fallback', () => {
  assert.deepEqual(showNetworks([{ name: 'HBO' }, { name: 'Max' }, { name: 'HBO' }], 'Warner Bros'), ['HBO', 'Max'])
  assert.deepEqual(showNetworks([], ' Warner Bros '), ['Warner Bros'])
  assert.deepEqual(showNetworks(null, null), [])
  assert.deepEqual(showNetworks([{ name: ' ' }], ''), [])
})

test('a request covers the seasons it names, and a whole-show request covers all', () => {
  assert.equal(seasonIsRequested(2, [{ seasons: [2, 3] }]), true)
  assert.equal(seasonIsRequested(4, [{ seasons: [2, 3] }]), false)
  assert.equal(seasonIsRequested(4, [{ seasons: null }]), true)
  assert.equal(seasonIsRequested(4, []), false)
  assert.deepEqual(seasonsStillToRequest([1, 2, 3], [{ seasons: [2] }]), [1, 3])
  assert.deepEqual(seasonsStillToRequest([1, 2], [{ seasons: null }]), [])
})

test('requested seasons must be regular season numbers', () => {
  assert.deepEqual(readRequestedSeasons([3, 2, 3]), [2, 3])
  for (const bad of [undefined, null, [], [0], [-1], [1.5], ['1'], 'all']) {
    assert.equal(readRequestedSeasons(bad), null, JSON.stringify(bad))
  }
})

const plain = { numberingDiffers: false, requestedNow: false }

test('a complete season is owned, even when the numbering is doubted', () => {
  assert.deepEqual(
    decideSeasonStanding({ holding: 'complete', seerrStatus: 'none' }, { ...plain, numberingDiffers: true }),
    { standing: 'owned', requestable: false }
  )
})

test('doubted numbering claims nothing and offers nothing', () => {
  for (const holding of ['missing', 'partial'] as const) {
    assert.deepEqual(
      decideSeasonStanding({ holding, seerrStatus: 'none' }, { ...plain, numberingDiffers: true }),
      { standing: 'unclear', requestable: false }
    )
  }
})

test('a missing season is requestable until Seerr or a request has it', () => {
  assert.deepEqual(decideSeasonStanding({ holding: 'missing', seerrStatus: 'none' }, plain), {
    standing: 'missing',
    requestable: true,
  })
  for (const seerrStatus of ['requested', 'processing', 'available'] as const) {
    assert.deepEqual(decideSeasonStanding({ holding: 'missing', seerrStatus }, plain), {
      standing: 'seerr',
      requestable: false,
    })
  }
  assert.deepEqual(
    decideSeasonStanding({ holding: 'missing', seerrStatus: 'none' }, { ...plain, requestedNow: true }),
    { standing: 'requested', requestable: false }
  )
})

test('a partly held season stays a gap, and Seerr refusing it means no button', () => {
  assert.deepEqual(decideSeasonStanding({ holding: 'partial', seerrStatus: 'none' }, plain), {
    standing: 'partial',
    requestable: true,
  })
  assert.deepEqual(decideSeasonStanding({ holding: 'partial', seerrStatus: 'available' }, plain), {
    standing: 'partial',
    requestable: false,
  })
  assert.deepEqual(decideSeasonStanding({ holding: 'partial', seerrStatus: 'processing' }, plain), {
    standing: 'seerr',
    requestable: false,
  })
})

function stored(seasonNumber: number, holding: StoredSeason['holding'], seerrStatus: StoredSeason['seerrStatus'] = 'none'): StoredSeason {
  return { seasonNumber, airDate: '2020-01-01', posterPath: null, airedEpisodes: 10, heldEpisodes: 0, holding, seerrStatus }
}

const showRow = {
  tmdbId: 1,
  title: 'A Show',
  posterPath: null,
  networks: ['HBO'],
  libraryId: 'lib',
  numberingDiffers: false,
}

test('a show ships its counts decided, with a request made since the scan applied', () => {
  const show = decideSeriesGapShow(
    {
      ...showRow,
      seasons: [
        stored(1, 'complete'),
        stored(2, 'missing'),
        stored(3, 'missing'),
        stored(4, 'partial'),
        stored(5, 'missing', 'processing'),
      ],
    },
    [{ seasons: [3] }]
  )
  assert.deepEqual(
    { total: show.total, owned: show.owned, missing: show.missing, partial: show.partial, pending: show.pending },
    { total: 5, owned: 1, missing: 1, partial: 1, pending: 2 }
  )
  assert.deepEqual(
    show.seasons.filter((s) => s.requestable).map((s) => s.seasonNumber),
    [2, 4]
  )
  assert.equal('holding' in show.seasons[0], false)
})

test('a show with doubted numbering has no gaps to act on', () => {
  const show = decideSeriesGapShow(
    { ...showRow, numberingDiffers: true, seasons: [stored(1, 'complete'), stored(2, 'missing')] },
    []
  )
  assert.equal(show.missing, 0)
  assert.equal(show.partial, 0)
  assert.equal(show.seasons.some((s) => s.requestable), false)
  assert.equal(show.seasons[1].standing, 'unclear')
})
