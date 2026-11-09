import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOUSEHOLD_REACH_LEVELS,
  householdReach,
  type HouseholdReach,
  type WatcherCount,
} from './householdReach.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const source = (...path: string[]) => readFileSync(join(REPO_ROOT, ...path), 'utf8')

/** A thinly watched library: most titles have one watcher, a few have many. */
const LIBRARY: WatcherCount[] = [
  { watchers: 1, titles: 800 },
  { watchers: 2, titles: 120 },
  { watchers: 3, titles: 50 },
  { watchers: 4, titles: 20 },
  { watchers: 7, titles: 8 },
  { watchers: 12, titles: 2 },
]

test('levels climb with the audience in a thinly watched library', () => {
  const levels = [1, 2, 3, 4, 7, 12].map((watchers) => householdReach(watchers, LIBRARY))
  const expected: HouseholdReach[] = [
    'niche',
    'familiar',
    'popular',
    'popular',
    'mostWatched',
    'mostWatched',
  ]
  assert.deepEqual(levels, expected)
})

test('no watchers, or nothing to compare with, has no level', () => {
  assert.equal(householdReach(0, LIBRARY), undefined)
  assert.equal(householdReach(-1, LIBRARY), undefined)
  assert.equal(householdReach(3, []), undefined)
})

test('when every title has the same audience there is nothing to compare', () => {
  assert.equal(householdReach(1, [{ watchers: 1, titles: 500 }]), undefined)
  assert.equal(householdReach(4, [{ watchers: 4, titles: 500 }]), undefined)
})

test('the smallest audience is the lowest level, however many people that is', () => {
  const together = [
    { watchers: 3, titles: 100 },
    { watchers: 4, titles: 20 },
  ]
  assert.equal(householdReach(3, together), 'niche')
  assert.equal(householdReach(4, together), 'mostWatched')
})

test('the largest audience is the top level even where it is too common to clear the floor', () => {
  const household = [
    { watchers: 1, titles: 100 },
    { watchers: 2, titles: 60 },
    { watchers: 3, titles: 30 },
    { watchers: 4, titles: 10 },
  ]
  assert.equal(householdReach(3, household), 'familiar')
  assert.equal(householdReach(4, household), 'mostWatched')
})

test('a count newer than the histogram is the top level', () => {
  assert.equal(householdReach(13, LIBRARY), 'mostWatched')
})

test('the web scale lists the same levels in the same order', () => {
  const web = source('apps', 'web', 'src', 'pages', 'media-detail', 'reachScale.ts')
  const list = web.match(/REACH_LEVELS = \[([^\]]*)\]/)
  assert.ok(list, 'REACH_LEVELS not found in reachScale.ts')
  const levels = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(levels, [...HOUSEHOLD_REACH_LEVELS])
})
