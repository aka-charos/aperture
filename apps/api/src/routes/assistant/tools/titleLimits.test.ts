import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayRatingAtLeastSql, WATCH_HISTORY_PLAYED_SQL } from '@aperture/core'
import {
  describeTitleLimits,
  discoveryLimitsNote,
  hasTitleLimits,
  joinNotes,
  matchingGenreNames,
  mediaTypesOf,
  NO_LIMITS,
  noFitNote,
  readTitleLimits,
  resolveGenreLimit,
  SERIES_WITHIN_RUNTIME_SQL,
  titleLimitClauses,
  titleLimitsSql,
  toolsUnderLimits,
  turnStatedLimits,
  watchStatusCondition,
  type LimitFacts,
  type TitleLimits,
} from './titleLimits.js'

const NO_FACTS: LimitFacts = { genreNames: [], seriesWithinRuntime: [] }

/** The clauses and what they bound, numbered from `first` as a query would. */
function clausesFor(
  limits: TitleLimits,
  media: 'movie' | 'series',
  facts: LimitFacts = NO_FACTS,
  first = 1
) {
  const values: unknown[] = []
  const clauses = titleLimitClauses(
    limits,
    media,
    't',
    (value) => {
      values.push(value)
      return `$${first + values.length - 1}`
    },
    facts
  )
  return { clauses, values }
}

test('a zero from a model is no limit, and would otherwise hide every unrated title', () => {
  assert.deepEqual(readTitleLimits({ genre: ' ', yearMin: 0, yearMax: 0, minRating: 0, maxRuntime: 0 }), {})
  assert.equal(hasTitleLimits(readTitleLimits({ minRating: 0 })), false)
  assert.deepEqual(readTitleLimits({ genre: null, yearMin: null, minRating: null }), {})
})

test('fractions round to the side that still honours the limit', () => {
  assert.deepEqual(readTitleLimits({ yearMin: 1990.5, yearMax: 1999.5, maxRuntime: 90.9 }), {
    yearMin: 1991,
    yearMax: 1999,
    maxRuntime: 90,
  })
  // A rating is a decimal in the database, so it stays as asked.
  assert.deepEqual(readTitleLimits({ minRating: 7.5 }), { minRating: 7.5 })
})

test('sci-fi finds every way the library spells it', () => {
  const stored = ['Science Fiction', 'Sci-Fi', 'Sci-Fi & Fantasy', 'Fantasy', 'Drama']
  const expected = ['Science Fiction', 'Sci-Fi', 'Sci-Fi & Fantasy']
  for (const asked of ['sci-fi', 'Sci Fi', 'scifi', 'SCIENCE FICTION']) {
    assert.deepEqual(matchingGenreNames(asked, stored), expected, asked)
  }
})

test('a compound genre counts as each of its parts, in both directions', () => {
  const stored = ['Action & Adventure', 'War & Politics', 'Action', 'Adventure']
  assert.deepEqual(matchingGenreNames('Action', stored), ['Action & Adventure', 'Action'])
  assert.deepEqual(matchingGenreNames('Politics', stored), ['War & Politics'])
  assert.deepEqual(matchingGenreNames('Action & Adventure', stored), [
    'Action & Adventure',
    'Action',
    'Adventure',
  ])
})

test('a genre matches whole words only', () => {
  assert.deepEqual(matchingGenreNames('war', ['Western', 'Star Wars', 'War']), ['War'])
  assert.deepEqual(matchingGenreNames('drama', ['Melodrama', 'Drama']), ['Drama'])
  assert.deepEqual(matchingGenreNames('science', ['Science Fiction']), [])
})

test('accents and non-Latin names compare instead of folding away', () => {
  assert.deepEqual(matchingGenreNames('comedie', ['Comédie']), ['Comédie'])
  assert.deepEqual(matchingGenreNames('Δράμα', ['Δράμα', 'Κωμωδία']), ['Δράμα'])
  assert.deepEqual(matchingGenreNames('!!!', ['Drama']), [])
})

test('ratings use the rating a title shows, never the raw column', () => {
  const { clauses, values } = clausesFor({ minRating: 7 }, 'movie')
  assert.deepEqual(clauses, [displayRatingAtLeastSql('t', '$1')])
  assert.deepEqual(values, [7])
})

test('a film has to have a runtime above zero to fit a maximum', () => {
  const { clauses, values } = clausesFor({ maxRuntime: 90 }, 'movie')
  assert.deepEqual(clauses, ['(t.runtime_minutes > 0 AND t.runtime_minutes <= $1)'])
  assert.deepEqual(values, [90])
})

test('a series fits a maximum through the list read ahead, not a per-row aggregate', () => {
  const { clauses, values } = clausesFor({ maxRuntime: 30 }, 'series', {
    genreNames: [],
    seriesWithinRuntime: ['a', 'b'],
  })
  assert.deepEqual(clauses, ['t.id = ANY($1::uuid[])'])
  assert.deepEqual(values, [['a', 'b']])
})

test('a series runtime leaves out specials and episodes of unknown length', () => {
  assert.match(SERIES_WITHIN_RUNTIME_SQL, /season_number > 0/)
  assert.match(SERIES_WITHIN_RUNTIME_SQL, /runtime_minutes > 0/)
  assert.match(SERIES_WITHIN_RUNTIME_SQL, /percentile_cont\(0\.5\)/)
  assert.match(SERIES_WITHIN_RUNTIME_SQL, /<= \$1/)
})

test('a genre filter binds the stored names, and none of them matches nothing', () => {
  const { clauses, values } = clausesFor({ genre: 'sci-fi' }, 'movie', {
    genreNames: ['Science Fiction'],
    seriesWithinRuntime: [],
  })
  assert.deepEqual(clauses, ['t.genres && $1::text[]'])
  assert.deepEqual(values, [['Science Fiction']])

  // Empty overlaps nothing; it must not read as "no genre filter".
  const none = clausesFor({ genre: 'nonsense' }, 'movie')
  assert.deepEqual(none.clauses, ['t.genres && $1::text[]'])
  assert.deepEqual(none.values, [[]])
})

test('placeholders number from wherever the query has got to, in clause order', () => {
  const { clauses, values } = clausesFor(
    { genre: 'Drama', yearMin: 1970, yearMax: 1979, minRating: 7, maxRuntime: 90 },
    'movie',
    { genreNames: ['Drama'], seriesWithinRuntime: [] },
    5
  )
  assert.deepEqual(clauses, [
    't.genres && $5::text[]',
    't.year >= $6',
    't.year <= $7',
    displayRatingAtLeastSql('t', '$8'),
    '(t.runtime_minutes > 0 AND t.runtime_minutes <= $9)',
  ])
  assert.deepEqual(values, [['Drama'], 1970, 1979, 7, 90])
})

test('no limits, no clauses', () => {
  assert.deepEqual(clausesFor({}, 'movie').clauses, [])
  assert.deepEqual(clausesFor({}, 'series').clauses, [])
})

test('watched means played, because favoriting writes a history row', () => {
  for (const isMovie of [true, false]) {
    const sql = watchStatusCondition('unwatched', isMovie, 't.id', 4)
    assert.ok(sql.includes(WATCH_HISTORY_PLAYED_SQL), sql)
    assert.ok(sql.startsWith('NOT EXISTS'), sql)
    assert.ok(sql.includes('$4'), sql)
  }
  assert.ok(watchStatusCondition('watched', true, 't.id', 4).startsWith('EXISTS'))
})

test('limits read as a sentence', () => {
  assert.equal(
    describeTitleLimits({ genre: 'Thriller', yearMin: 1970, yearMax: 1979, minRating: 7, maxRuntime: 90 }),
    'genre Thriller; released 1970 to 1979; rated at least 7; at most 90 minutes'
  )
  assert.equal(describeTitleLimits({ yearMin: 2000 }), 'released in or after 2000')
  assert.equal(describeTitleLimits({ yearMax: 2000 }), 'released in or before 2000')
})

test('an empty answer names the limits and never claims nothing exists', () => {
  const note = noFitNote('at most 20 minutes')
  assert.match(note, /at most 20 minutes/)
  assert.match(note, /not that none exist/)
})

test('a plural finds the genre, on either side', () => {
  assert.deepEqual(matchingGenreNames('thrillers', ['Thriller', 'Drama']), ['Thriller'])
  assert.deepEqual(matchingGenreNames('comedies', ['Comedy', 'Drama']), ['Comedy'])
  assert.deepEqual(matchingGenreNames('Documentary', ['Documentaries']), ['Documentaries'])
  assert.deepEqual(matchingGenreNames('News', ['News']), ['News'])
  // It stays whole words: a plural must not open up the substring case.
  assert.deepEqual(matchingGenreNames('wars', ['Star Wars', 'War']), ['War'])
})

test('a genre the library lacks is left out and reported, not enforced as nothing', () => {
  const resolved = resolveGenreLimit(
    { genre: 'Heist', maxRuntime: 90 },
    { movie: ['Drama', 'Comedy'], series: ['Drama', 'Reality'] }
  )
  assert.deepEqual(resolved.limits, { maxRuntime: 90 })
  assert.match(resolved.ignoredGenreNote ?? '', /"Heist" is not one of this library's genres/)
  // Each name once, sorted, across both media types.
  assert.match(resolved.ignoredGenreNote ?? '', /Comedy, Drama, Reality\./)
})

test('a genre one media type lacks is still a limit on a search of both', () => {
  const resolved = resolveGenreLimit(
    { genre: 'Reality' },
    { movie: ['Drama'], series: ['Reality'] }
  )
  assert.deepEqual(resolved.limits, { genre: 'Reality' })
  assert.equal(resolved.ignoredGenreNote, null)
  assert.deepEqual(resolved.genreNames, { movie: [], series: ['Reality'] })
})

test('no genre asked for reads as nothing to resolve', () => {
  const resolved = resolveGenreLimit({ maxRuntime: 90 }, {})
  assert.deepEqual(resolved.limits, { maxRuntime: 90 })
  assert.equal(resolved.ignoredGenreNote, null)
})

test('no limits leave the query exactly as it was', () => {
  assert.equal(titleLimitsSql(NO_LIMITS, 'movie', 'm', () => '$1'), '')
  assert.equal(titleLimitsSql(NO_LIMITS, 'series', 's', () => '$1'), '')
})

test('the predicate reads the facts of the media type it is for', () => {
  const resolved = {
    ...NO_LIMITS,
    limits: { genre: 'Reality' },
    facts: {
      movie: { genreNames: [], seriesWithinRuntime: [] },
      series: { genreNames: ['Reality'], seriesWithinRuntime: [] },
    },
  }
  const values: unknown[] = []
  const bind = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }
  assert.equal(titleLimitsSql(resolved, 'series', 's', bind), 'AND s.genres && $1::text[]')
  assert.deepEqual(values, [['Reality']])
})

test('media types of a search', () => {
  assert.deepEqual(mediaTypesOf('both'), ['movie', 'series'])
  assert.deepEqual(mediaTypesOf('movies'), ['movie'])
  assert.deepEqual(mediaTypesOf('series'), ['series'])
})

test('the discovery note reports each section, and asks to say what was emptied', () => {
  const note = discoveryLimitsNote('at most 90 minutes', [
    { label: 'Web picks', found: 7, shown: 0, emptiedByLimits: true },
    { label: 'From the taste profile', found: null, shown: 4, emptiedByLimits: false },
  ])
  assert.match(note, /held to these limits: at most 90 minutes/)
  assert.match(note, /Web picks: 7 found in the library, 0 fit/)
  assert.match(note, /From the taste profile: 4 fit/)
  assert.match(note, /which sections came back empty/)
})

test('the discovery note has nothing to ask for when every section has cards', () => {
  const note = discoveryLimitsNote('films only', [
    { label: 'Web picks', found: 2, shown: 2, emptiedByLimits: false },
  ])
  assert.doesNotMatch(note, /came back empty/)
  assert.doesNotMatch(note, /No title was found/)
})

test('a section empty for another reason is not blamed on the limits', () => {
  const note = discoveryLimitsNote('at most 90 minutes', [
    { label: 'Web picks', found: 0, shown: 0, emptiedByLimits: false },
    { label: 'From the taste profile', found: null, shown: 0, emptiedByLimits: false },
  ])
  assert.match(note, /Web picks: 0 found in the library/)
  assert.match(note, /From the taste profile: nothing, and the limits are not why/)
  assert.match(note, /do not suggest relaxing them/)
  assert.doesNotMatch(note, /offer to relax/)
  assert.doesNotMatch(note, /came back empty/)
})

test('cards that all went to another section are not a limit emptying this one', () => {
  const note = discoveryLimitsNote('films only', [
    { label: 'Web picks', found: 4, shown: 4, emptiedByLimits: false },
    { label: 'Close to Heat', found: null, shown: 0, emptiedByLimits: false },
  ])
  assert.match(note, /Close to Heat: nothing, and the limits are not why/)
  assert.doesNotMatch(note, /came back empty/)
})

test('everything emptied by the limits gets the whole explanation', () => {
  const note = discoveryLimitsNote('films only; not yet played', [
    { label: 'Web picks', found: 2, shown: 0, emptiedByLimits: true },
  ])
  assert.match(note, /No title was found that fits these limits: films only; not yet played\./)
  assert.match(note, /offer to relax a limit/)
  assert.doesNotMatch(note, /which sections came back empty/)
})

test('notes that may be absent join into one, or none', () => {
  assert.equal(joinNotes(null, undefined), null)
  assert.equal(joinNotes('a', null, 'b'), 'a b')
})

test('the tools that know no limits go, and the ones that do stay', () => {
  assert.deepEqual(
    toolsUnderLimits([
      'getTopRated',
      'getTopByRtScore',
      'getAwardWinners',
      'getUnwatched',
      'getMyRecommendations',
      'getContentRankings',
      'searchByKeyword',
      'findSimilarContent',
      'getContentDetails',
      'searchContent',
      'semanticSearch',
    ]),
    ['getContentDetails', 'searchContent', 'semanticSearch']
  )
})

test('a turn has stated limits once a result carries a note', () => {
  assert.equal(turnStatedLimits([]), false)
  assert.equal(turnStatedLimits([{ toolResults: [{ output: { items: [] } }] }]), false)
  assert.equal(turnStatedLimits([{ toolResults: [{ output: { carousels: [], limitsNote: 'x' } }] }]), true)
  assert.equal(turnStatedLimits([{ toolResults: [{ output: null }, { output: 'text' }] }]), false)
})

test('a library search with limits counts even when it found plenty and has no note', () => {
  const call = (toolName: string, input: unknown) => [{ toolCalls: [{ toolName, input }] }]
  assert.equal(turnStatedLimits(call('semanticSearch', { concept: 'x', maxRuntime: 90 })), true)
  assert.equal(turnStatedLimits(call('searchMyRecommendations', { concept: 'x', genre: 'Drama' })), true)
  // No limit in it, a zero that means none, and a tool that takes them differently.
  assert.equal(turnStatedLimits(call('semanticSearch', { concept: 'x', type: 'movies' })), false)
  assert.equal(turnStatedLimits(call('semanticSearch', { concept: 'x', minRating: 0 })), false)
  assert.equal(turnStatedLimits(call('searchContent', { genre: 'Drama' })), false)
  // An input the schema would have refused must not throw here.
  assert.equal(turnStatedLimits(call('semanticSearch', { genre: 7 })), false)
  assert.equal(turnStatedLimits(call('semanticSearch', null)), false)
})
