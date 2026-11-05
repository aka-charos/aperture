import test from 'node:test'
import assert from 'node:assert/strict'
import { watcherCountFilter } from './watcherFilter.js'

test('no usable bound adds nothing and binds nothing', () => {
  for (const [min, max] of [
    [undefined, undefined],
    ['', ''],
    ['abc', 'abc'],
    ['0', undefined],
    ['-3', '-1'],
  ] as const) {
    const params: unknown[] = ['already']
    assert.deepEqual(watcherCountFilter('movies', min, max, params), { join: '', where: '' })
    assert.deepEqual(params, ['already'])
  }
})

test('placeholders number after what the query already bound', () => {
  const params: unknown[] = ['a', 'b']
  const filter = watcherCountFilter('movies', '2', '5', params)
  assert.deepEqual(params, ['a', 'b', 2, 5])
  assert.equal(
    filter.where,
    'COALESCE(watchers.watcher_count, 0) >= $3 AND COALESCE(watchers.watcher_count, 0) <= $4'
  )
})

test('a maximum of 0 is a real request, and a title with no viewers can meet it', () => {
  const params: unknown[] = []
  const filter = watcherCountFilter('series', undefined, '0', params)
  assert.deepEqual(params, [0])
  assert.equal(filter.where, 'COALESCE(watchers.watcher_count, 0) <= $1')
  // Only a LEFT JOIN keeps a title the grouped counts have no row for.
  assert.match(filter.join, /^ LEFT JOIN \(/)
})

test('a lone minimum still leaves its maximum out', () => {
  const params: unknown[] = []
  const filter = watcherCountFilter('movies', '3', undefined, params)
  assert.deepEqual(params, [3])
  assert.equal(filter.where, 'COALESCE(watchers.watcher_count, 0) >= $1')
})

test('counts are by played rows and distinct people, on each table\'s own key', () => {
  const movies = watcherCountFilter('movies', '1', undefined, []).join
  assert.match(movies, /COUNT\(DISTINCT wh\.user_id\)/)
  assert.match(movies, /wh\.played = true/)
  assert.match(movies, /GROUP BY wh\.movie_id/)
  assert.match(movies, /watchers\.item_id = movies\.id/)
  assert.doesNotMatch(movies, /episodes/)

  const series = watcherCountFilter('series', '1', undefined, []).join
  assert.match(series, /COUNT\(DISTINCT wh\.user_id\)/)
  assert.match(series, /wh\.played = true/)
  assert.match(series, /INNER JOIN episodes e ON e\.id = wh\.episode_id/)
  assert.match(series, /GROUP BY e\.series_id/)
  assert.match(series, /watchers\.item_id = series\.id/)
})

test('a filter names only columns no list query reads', () => {
  // Handlers' WHERE and ORDER BY use bare column names (title, year, id…). The
  // joined counts expose two names, neither of which is on movies or series.
  for (const table of ['movies', 'series'] as const) {
    const join = watcherCountFilter(table, '1', undefined, []).join
    assert.match(join, /AS item_id, COUNT\(DISTINCT wh\.user_id\)::int AS watcher_count\s/)
  }
})
