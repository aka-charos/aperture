import test from 'node:test'
import assert from 'node:assert/strict'
import { orderGenreStripRowsByTaste, genreStripRowAffinity } from './genreStripOrder.js'
import type { GenreStripRowConfig } from '../settings/systemSettings.js'

const NAMES = new Map<number, string>([
  [28, 'Action'],
  [12, 'Adventure'],
  [35, 'Comedy'],
  [18, 'Drama'],
  [27, 'Horror'],
])

const row = (genreIds: number[], label?: string): GenreStripRowConfig => ({
  genreIds,
  limit: 20,
  ...(label ? { label } : {}),
})

const labels = (rows: GenreStripRowConfig[]) => rows.map((r) => r.genreIds.join('+'))

test('the genre this viewer watches most comes first', () => {
  const ordered = orderGenreStripRowsByTaste(
    [row([35]), row([27]), row([18])],
    NAMES,
    new Map([
      ['comedy', 0.8],
      ['horror', 1.25],
      ['drama', 1.05],
    ])
  )

  assert.deepEqual(labels(ordered), ['27', '18', '35'])
})

test('a multi-genre row rides its strongest genre, not its average', () => {
  // Loving Action and being indifferent to Adventure should put the combined
  // row high. A mean would bury it under a row for a genre this viewer likes
  // less than Action -- diluting the signal the row exists to carry.
  const ordered = orderGenreStripRowsByTaste(
    [row([18]), row([28, 12])],
    NAMES,
    new Map([
      ['action', 1.3],
      ['adventure', 0.7],
      ['drama', 1.1],
    ])
  )

  assert.deepEqual(labels(ordered), ['28+12', '18'])
})

test('ties keep the order the admin configured', () => {
  const ordered = orderGenreStripRowsByTaste(
    [row([28]), row([35]), row([18])],
    NAMES,
    new Map([
      ['action', 1.1],
      ['comedy', 1.1],
      ['drama', 1.1],
    ])
  )

  assert.deepEqual(labels(ordered), ['28', '35', '18'])
})

test('a viewer with no weights gets the configured order back untouched', () => {
  const rows = [row([27]), row([35]), row([28])]
  assert.deepEqual(orderGenreStripRowsByTaste(rows, NAMES, new Map()), rows)
})

test('a genre nobody has a weight for is unknown, not disliked', () => {
  // It resolves to neutral, so it sits among the neutral rows in configured
  // order rather than being pushed to the bottom. Anything else would punish a
  // row for a gap in our own data.
  const ordered = orderGenreStripRowsByTaste(
    [row([27]), row([28]), row([35])],
    NAMES,
    new Map([['comedy', 1.3]])
  )

  assert.deepEqual(labels(ordered), ['35', '27', '28'])
})

test('an unresolvable genre id does not drag its row down', () => {
  // The names come from TMDb and the weights from the library's own genre
  // column, so a mismatch is possible. Degrading to neutral means "no
  // personalization" rather than "wrong personalization".
  const affinity = genreStripRowAffinity(row([9999]), NAMES, new Map([['action', 1.3]]))
  assert.equal(affinity, 1)
})

test('genre names match case- and whitespace-insensitively', () => {
  const affinity = genreStripRowAffinity(
    row([28]),
    new Map([[28, '  ACTION ']]),
    new Map([['action', 1.3]])
  )
  assert.equal(affinity, 1.3)
})

test('a non-finite stored weight is ignored rather than propagated', () => {
  const affinity = genreStripRowAffinity(row([28]), NAMES, new Map([['action', NaN]]))
  assert.equal(affinity, 1)
})

test('nothing is ever dropped, whatever the weights', () => {
  const rows = [row([28]), row([12]), row([35]), row([18]), row([27])]
  const ordered = orderGenreStripRowsByTaste(
    rows,
    NAMES,
    new Map([
      ['action', 0.7],
      ['comedy', 1.3],
    ])
  )

  assert.equal(ordered.length, rows.length)
  assert.deepEqual([...labels(ordered)].sort(), [...labels(rows)].sort())
})

test('a single row is returned as-is', () => {
  const rows = [row([28])]
  assert.deepEqual(orderGenreStripRowsByTaste(rows, NAMES, new Map([['action', 1.3]])), rows)
})
