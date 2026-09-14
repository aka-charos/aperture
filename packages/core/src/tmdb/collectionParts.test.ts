import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyCollectionPart,
  deriveSeerrStatus,
  isReleasedReleaseDate,
} from './collectionParts.js'

const NOW = new Date('2026-09-14T23:30:00Z')

test('a release dated today counts as released, compared in UTC', () => {
  assert.equal(isReleasedReleaseDate('2026-09-14', NOW), true)
  assert.equal(isReleasedReleaseDate('2026-09-15', NOW), false)
  assert.equal(isReleasedReleaseDate('1975-03-27', NOW), true)
})

test('null, empty and malformed dates read as unreleased', () => {
  assert.equal(isReleasedReleaseDate(null, NOW), false)
  assert.equal(isReleasedReleaseDate(undefined, NOW), false)
  assert.equal(isReleasedReleaseDate('', NOW), false)
  assert.equal(isReleasedReleaseDate('2026', NOW), false)
  assert.equal(isReleasedReleaseDate('soon-ish!!', NOW), false)
})

test('a Seerr status reduces to the four states both surfaces act on', () => {
  assert.equal(deriveSeerrStatus(undefined), 'none')
  assert.equal(deriveSeerrStatus({ exists: true, status: 'available', requested: true }), 'available')
  assert.equal(deriveSeerrStatus({ exists: false, status: 'processing', requested: true }), 'processing')
  assert.equal(deriveSeerrStatus({ exists: false, status: 'pending', requested: true }), 'requested')
  assert.equal(deriveSeerrStatus({ exists: false, status: 'unknown', requested: false }), 'none')
})

test('in the library wins, even over a future release date', () => {
  const part = classifyCollectionPart({ releaseDate: '2030-01-01', inLibrary: true, now: NOW })
  assert.deepEqual(part, { status: 'owned', seerrStatus: 'available', requestable: false })
})

test('an unreleased part is never requestable but keeps its request status', () => {
  assert.deepEqual(classifyCollectionPart({ releaseDate: null, inLibrary: false, now: NOW }), {
    status: 'upcoming',
    seerrStatus: 'none',
    requestable: false,
  })
  const requested = classifyCollectionPart({
    releaseDate: '2027-05-01',
    inLibrary: false,
    seerr: { exists: false, status: 'pending', requested: true },
    now: NOW,
  })
  assert.equal(requested.status, 'upcoming')
  assert.equal(requested.seerrStatus, 'requested')
  assert.equal(requested.requestable, false)
})

test('Seerr having a title this library lacks is not an invitation to request it', () => {
  const part = classifyCollectionPart({
    releaseDate: '1999-01-01',
    inLibrary: false,
    seerr: { exists: true, status: 'available', requested: false },
    now: NOW,
  })
  assert.deepEqual(part, { status: 'available', seerrStatus: 'available', requestable: false })
})

test('a title already in the pipeline takes that status and is not requestable', () => {
  for (const [seerr, expected] of [
    [{ exists: false, status: 'processing', requested: true }, 'processing'],
    [{ exists: false, status: 'pending', requested: true }, 'requested'],
  ] as const) {
    const part = classifyCollectionPart({ releaseDate: '2001-01-01', inLibrary: false, seerr, now: NOW })
    assert.equal(part.status, expected)
    assert.equal(part.requestable, false)
  }
})

test('only a released part nobody has or has asked for is requestable', () => {
  assert.deepEqual(classifyCollectionPart({ releaseDate: '1980-12-19', inLibrary: false, now: NOW }), {
    status: 'missing',
    seerrStatus: 'none',
    requestable: true,
  })
})
