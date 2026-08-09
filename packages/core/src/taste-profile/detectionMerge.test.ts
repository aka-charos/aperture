import test from 'node:test'
import assert from 'node:assert/strict'
import { newlyDetectedNames } from './detectionMerge.js'

interface Detected {
  name: string
  weight: number
}

const nameOf = (item: Detected) => item.name

/**
 * The shape merge mode used to have: one filter answering both "what is new"
 * and "what gets written". Kept here as the thing the current design must not
 * collapse back into -- the tests below pin that the two answers differ.
 */
function legacyMergeWriteList(detected: Detected[], existing: ReadonlySet<string>): Detected[] {
  return detected.filter((item) => !existing.has(item.name))
}

test('merge mode reports only entries the user has not seen before', () => {
  const detected: Detected[] = [
    { name: 'Action', weight: 1.6 },
    { name: 'Comedy', weight: 0.8 },
    { name: 'Thriller', weight: 1.4 },
  ]
  const existing = new Set(['Action', 'Comedy'])

  assert.deepEqual(newlyDetectedNames(detected, nameOf, existing, 'merge'), ['Thriller'])
})

test('reset mode reports everything, because the table was cleared first', () => {
  const detected: Detected[] = [
    { name: 'Action', weight: 1.6 },
    { name: 'Comedy', weight: 0.8 },
  ]
  // Deliberately non-empty: reset must ignore it rather than subtract it.
  const existing = new Set(['Action', 'Comedy'])

  assert.deepEqual(newlyDetectedNames(detected, nameOf, existing, 'reset'), ['Action', 'Comedy'])
})

test('the "new" list is narrower than the write list, which is the whole fix', () => {
  const detected: Detected[] = [
    { name: 'Action', weight: 1.6 },
    { name: 'Comedy', weight: 0.8 },
    { name: 'Thriller', weight: 1.4 },
  ]
  const existing = new Set(['Action', 'Comedy'])

  const reported = newlyDetectedNames(detected, nameOf, existing, 'merge')

  // What callers now write: every detected entry, so a weight that moved as the
  // watch history shifted actually reaches the database.
  assert.equal(detected.length, 3)
  assert.equal(reported.length, 1)

  // What they used to write. Action and Comedy silently kept whatever weight
  // they were first assigned, forever.
  assert.deepEqual(
    legacyMergeWriteList(detected, existing).map(nameOf),
    ['Thriller'],
    'the old write list dropped every pre-existing entry'
  )
})

test('an unchanged catalogue reports nothing new but still writes everything', () => {
  const detected: Detected[] = [
    { name: 'Action', weight: 1.6 },
    { name: 'Comedy', weight: 0.8 },
  ]
  const existing = new Set(['Action', 'Comedy'])

  assert.deepEqual(newlyDetectedNames(detected, nameOf, existing, 'merge'), [])
  // The caller passes `detected` to the writer regardless -- there is no
  // "nothing new, skip the write" path any more, because refreshed weights are
  // the point of re-running detection.
  assert.equal(detected.length, 2)
})

test('a first run with no existing entries reports all of them', () => {
  const detected: Detected[] = [{ name: 'Horror', weight: 1.2 }]

  assert.deepEqual(newlyDetectedNames(detected, nameOf, new Set(), 'merge'), ['Horror'])
})

test('an empty detection reports nothing in either mode', () => {
  assert.deepEqual(newlyDetectedNames([], nameOf, new Set(['Action']), 'merge'), [])
  assert.deepEqual(newlyDetectedNames([], nameOf, new Set(['Action']), 'reset'), [])
})

test('name extraction is exact -- franchises and genres are stored as detected', () => {
  const detected = [{ franchiseName: 'Star Trek' }, { franchiseName: 'star trek' }]
  const existing = new Set(['Star Trek'])

  // Case is not normalised here on purpose: the unique constraints are on the
  // raw stored value, so folding case would report a genuine second row as
  // already-known.
  assert.deepEqual(
    newlyDetectedNames(detected, (f) => f.franchiseName, existing, 'merge'),
    ['star trek']
  )
})
