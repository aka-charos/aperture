import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeMarker, episodeWatchCondition, formatEpisodeItem } from './episodes.js'
import type { EpisodeSearchRow } from './episodes.js'

/**
 * Episode search is the first tool whose cards are not whole titles, and that
 * breaks two assumptions the card pipeline had baked in: that `id` is something
 * a detail route accepts, and that `type` says what a card is. Both are pinned
 * here, because both fail silently — a wrong id opens a blank dialog, and a
 * missing `episode` marker makes an episode render as though it were the show.
 */

function row(overrides: Partial<EpisodeSearchRow> = {}): EpisodeSearchRow {
  return {
    id: 'ep-1',
    title: '4 Days Out',
    season_number: 2,
    episode_number: 9,
    overview: 'Stranded in the desert with a dead battery.',
    year: 2009,
    community_rating: 9.2,
    poster_url: 'https://example.test/still.jpg',
    provider_item_id: 'emby-42',
    series_id: 'series-1',
    series_title: 'Breaking Bad',
    series_poster_url: 'https://example.test/series.jpg',
    ...overrides,
  }
}

// ============================================================================
// Identity: which id is the card, which id is the destination
// ============================================================================

test('the card id is the episode, not the series', () => {
  // ContentCarousel keys React on `id`. Two episodes of one show sharing the
  // series id would collide, drop a card and warn in the console.
  const a = formatEpisodeItem(row({ id: 'ep-1', episode_number: 9 }), null)
  const b = formatEpisodeItem(row({ id: 'ep-2', episode_number: 10 }), null)
  assert.notEqual(a.id, b.id)
  assert.equal(a.id, 'ep-1')
})

test('the series travels separately, because it is the navigation target', () => {
  // No detail route accepts an episode id — ContentCard reads
  // `episode.seriesId` and opens the show.
  const item = formatEpisodeItem(row(), null)
  assert.equal(item.episode?.seriesId, 'series-1')
  assert.equal(item.actions?.find((a) => a.id === 'details')?.href, '/series/series-1')
})

test('the episode marker carries season and number for the model', () => {
  const item = formatEpisodeItem(row(), null)
  assert.equal(item.episode?.season, 2)
  assert.equal(item.episode?.number, 9)
  assert.equal(item.episode?.seriesTitle, 'Breaking Bad')
})

test('a play link is offered only when the media server gave one', () => {
  assert.equal(formatEpisodeItem(row(), null).actions?.some((a) => a.id === 'play'), false)
  const withLink = formatEpisodeItem(row(), 'https://emby.test/play')
  assert.equal(withLink.actions?.find((a) => a.id === 'play')?.href, 'https://emby.test/play')
})

// ============================================================================
// The subtitle, which ContentCard parses rather than reads
// ============================================================================

test('the year leads the subtitle so the card lifts it into the title', () => {
  // splitMeta() only treats the FIRST segment as a year, and only if it is four
  // digits. Any other order silently drops the year into the meta line.
  const item = formatEpisodeItem(row(), null)
  assert.equal(item.subtitle, '2009 · Breaking Bad · S02E09')
  assert.match(item.subtitle!.split('·')[0].trim(), /^\d{4}$/)
})

test('a missing year leaves a well-formed subtitle', () => {
  const item = formatEpisodeItem(row({ year: null }), null)
  assert.equal(item.subtitle, 'Breaking Bad · S02E09')
})

test('episode markers are zero-padded so a season list sorts as it reads', () => {
  assert.equal(episodeMarker(2, 9), 'S02E09')
  assert.equal(episodeMarker(10, 12), 'S10E12')
  // Not padded: "S1E10" sorts before "S1E9" as text.
  assert.ok(episodeMarker(1, 10) > episodeMarker(1, 9))
})

// ============================================================================
// Ratings: pg hands NUMERIC back as a string
// ============================================================================

test('a NUMERIC rating arriving as a string becomes a number', () => {
  // '9.20' is truthy and 0 is not, which is how a 0 score once rendered as a
  // confident red badge elsewhere in this app.
  const item = formatEpisodeItem(row({ community_rating: '9.20' }), null)
  assert.equal(item.rating, 9.2)
})

test('a zero rating survives as 0, and an absent one as null', () => {
  assert.equal(formatEpisodeItem(row({ community_rating: '0.00' }), null).rating, 0)
  assert.equal(formatEpisodeItem(row({ community_rating: null }), null).rating, null)
})

// ============================================================================
// Poster fallback
// ============================================================================

test('an episode with no still borrows the series poster', () => {
  // Many libraries hold no per-episode art. A card with no image beside cards
  // with images reads as broken rather than sparse.
  const item = formatEpisodeItem(row({ poster_url: null }), null)
  assert.equal(item.image, 'https://example.test/series.jpg')
})

test('no art anywhere is null, never undefined-as-a-URL', () => {
  const item = formatEpisodeItem(row({ poster_url: null, series_poster_url: null }), null)
  assert.equal(item.image, null)
})

// ============================================================================
// Watch-status SQL
// ============================================================================

test('the watch predicate flips direction and binds exactly one parameter', () => {
  const watched = episodeWatchCondition('watched', 4)
  const unwatched = episodeWatchCondition('unwatched', 4)
  assert.match(watched, /ep\.id IN \(/)
  assert.match(unwatched, /ep\.id NOT IN \(/)
  for (const sql of [watched, unwatched]) {
    assert.deepEqual(sql.match(/\$\d+/g), ['$4'])
  }
})

test('the predicate reads episode_id and excludes movie rows', () => {
  // watch_history holds movies and episodes in one table under a check
  // constraint; without the NOT NULL guard a movie row contributes a NULL that
  // makes NOT IN return no rows at all.
  const sql = episodeWatchCondition('watched', 1)
  assert.match(sql, /episode_id IS NOT NULL/)
})
