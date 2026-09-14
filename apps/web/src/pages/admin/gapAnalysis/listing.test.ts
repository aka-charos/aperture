import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGapListings,
  compareByRelease,
  listingMatchesSearch,
  matchesMissingFilter,
  relativeTimeParts,
  sortGapListings,
  type GapCollectionListing,
  type GapCollectionSummary,
  type GapMissingTitle,
} from './listing'

function summary(id: number, name: string, total: number, owned: number): GapCollectionSummary {
  return {
    collectionId: id,
    collectionName: name,
    collectionPosterPath: null,
    totalReleased: total,
    ownedCount: owned,
    seerrCount: 0,
    missingCount: total - owned,
  }
}

function gap(collectionId: number, tmdbId: number, title: string, releaseDate: string | null): GapMissingTitle {
  return {
    tmdbId,
    collectionId,
    title,
    releaseDate,
    releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    posterPath: null,
  }
}

function listing(name: string, total: number, owned: number, missing: number): GapCollectionListing {
  return {
    collectionId: name.length,
    name,
    posterPath: null,
    total,
    owned,
    pending: total - owned - missing,
    missing: Array.from({ length: missing }, (_, i) => gap(name.length, i, `${name} ${i}`, null)),
  }
}

test('missing is the open gaps listed, and what the scan counted beyond them is pending', () => {
  // Scanned as 2 owned of 5; one of the three gaps has been requested since,
  // so /results returns only two.
  const [row] = buildGapListings(
    [summary(1, 'Trilogy+', 5, 2)],
    [gap(1, 10, 'Part Four', '1990-01-01'), gap(1, 11, 'Part Five', '1992-01-01')]
  )
  assert.equal(row.missing.length, 2)
  assert.equal(row.pending, 1)
  assert.equal(row.owned + row.pending + row.missing.length, row.total)
})

test('pending never goes negative when counts drift', () => {
  const [row] = buildGapListings([summary(1, 'Drifted', 2, 2)], [gap(1, 10, 'Extra', null)])
  assert.equal(row.pending, 0)
})

test('a collection without open gaps, and a gap without a summary, are both left out', () => {
  const rows = buildGapListings(
    [summary(1, 'Complete in Seerr', 3, 2), summary(2, 'Has a gap', 2, 1)],
    [gap(2, 20, 'Sequel', '2001-05-01'), gap(3, 30, 'Mid-scan orphan', '1999-01-01')]
  )
  assert.deepEqual(
    rows.map((r) => r.collectionId),
    [2]
  )
})

test('missing films read in release order, undated last', () => {
  const [row] = buildGapListings(
    [summary(1, 'Serial', 4, 0)],
    [gap(1, 1, 'Undated', null), gap(1, 2, 'Third', '1940-03-01'), gap(1, 3, 'First', '1938-01-01')]
  )
  assert.deepEqual(
    row.missing.map((m) => m.title),
    ['First', 'Third', 'Undated']
  )
  assert.ok(compareByRelease({ releaseYear: 1950, title: 'b' }, { releaseYear: null, title: 'a' }) < 0)
})

test('closest to complete puts a nearly finished collection above a dabble', () => {
  const bond = listing('James Bond', 26, 24, 2)
  const serial = listing('Three Mesquiteers', 51, 2, 49)
  const pair = listing('Sniper', 2, 1, 1)
  const sorted = sortGapListings([serial, pair, bond], 'closest')
  assert.deepEqual(
    sorted.map((l) => l.name),
    ['James Bond', 'Sniper', 'Three Mesquiteers']
  )
})

test('closest breaks an equal share on fewer films to finish, then on more owned', () => {
  const oneOfTwo = listing('A pair', 2, 1, 1)
  const twoOfFour = listing('A quartet', 4, 2, 2)
  const threeOfSix = listing('A sextet', 6, 3, 3)
  assert.deepEqual(
    sortGapListings([threeOfSix, twoOfFour, oneOfTwo], 'closest').map((l) => l.name),
    ['A pair', 'A quartet', 'A sextet']
  )
  // Pending counts as closed: the same gap count with more already requested is closer.
  const requested = { ...listing('Requested', 4, 1, 1), pending: 2 }
  const untouched = listing('Untouched', 4, 1, 3)
  assert.equal(sortGapListings([untouched, requested], 'closest')[0].name, 'Requested')
})

test('most missing and name sorts', () => {
  const a = listing('beta', 5, 1, 4)
  const b = listing('Alpha', 3, 1, 2)
  assert.deepEqual(
    sortGapListings([b, a], 'mostMissing').map((l) => l.name),
    ['beta', 'Alpha']
  )
  assert.deepEqual(
    sortGapListings([a, b], 'name').map((l) => l.name),
    ['Alpha', 'beta']
  )
})

test('missing filter buckets partition every count', () => {
  for (let n = 1; n <= 60; n++) {
    const hits = (['one', 'few', 'many'] as const).filter((f) => matchesMissingFilter(n, f))
    assert.equal(hits.length, 1, `count ${n} must land in exactly one bucket`)
    assert.ok(matchesMissingFilter(n, 'any'))
  }
  assert.ok(matchesMissingFilter(1, 'one'))
  assert.ok(matchesMissingFilter(4, 'few'))
  assert.ok(matchesMissingFilter(5, 'many'))
})

test('search folds accents and matches a missing title as well as the collection name', () => {
  const row: GapCollectionListing = {
    ...listing('Purché finisca bene', 24, 1, 0),
    missing: [gap(1, 1, 'Il Conte di Montecristo', null)],
  }
  assert.ok(listingMatchesSearch(row, 'purche'))
  assert.ok(listingMatchesSearch(row, 'MONTECRISTO'))
  assert.ok(listingMatchesSearch(row, '   '))
  assert.ok(!listingMatchesSearch(row, 'bond'))
})

test('relative time floors toward the past and never says zero units ago', () => {
  const now = new Date('2026-09-15T12:00:00Z')
  assert.deepEqual(relativeTimeParts(new Date('2026-04-09T13:47:34Z'), now), { value: -5, unit: 'month' })
  assert.deepEqual(relativeTimeParts(new Date('2026-09-15T11:59:30Z'), now), { value: 0, unit: 'minute' })
  assert.ok(!Object.is(relativeTimeParts(new Date('2026-09-15T11:59:30Z'), now).value, -0))
  assert.deepEqual(relativeTimeParts(new Date('2026-09-15T09:00:00Z'), now), { value: -3, unit: 'hour' })
  assert.deepEqual(relativeTimeParts(new Date('2026-09-01T12:00:00Z'), now), { value: -14, unit: 'day' })
  // 359 days: eleven months, not a rounded twelve.
  assert.deepEqual(relativeTimeParts(new Date(now.getTime() - 359 * 86_400_000), now), { value: -11, unit: 'month' })
  assert.deepEqual(relativeTimeParts(new Date('2024-09-01T12:00:00Z'), now), { value: -2, unit: 'year' })
})
