import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderReasons, readStartParam, reasonText } from './reasons'
import type { NextReason } from './types'
import type { TrailEntity } from '../trails/types'

const person = (name: string): TrailEntity => ({ key: `person:${name}`, kind: 'person', name, photo: null, titleCount: 4 })

test('the most telling reason leads, and closeness in feel comes last', () => {
  const reasons: NextReason[] = [
    { kind: 'feel', rank: 3 },
    { kind: 'company', entity: { ...person('A24'), kind: 'company' }, finished: 4, ratio: 3.2 },
    { kind: 'shared', entity: person('Hal Hartley'), rolesThere: ['director'], rolesHere: ['director'] },
  ]
  assert.deepEqual(
    orderReasons(reasons).map((r) => r.kind),
    ['shared', 'company', 'feel']
  )
})

test('a shared person names one role when both titles give the same one, else both', () => {
  assert.deepEqual(
    reasonText({ kind: 'shared', entity: person('Hal Hartley'), rolesThere: ['director'], rolesHere: ['director', 'writer'] }, 'Trust', 'movie'),
    { key: 'next.reason.sharedSame', name: 'Hal Hartley', role: 'director' }
  )
  assert.deepEqual(
    reasonText({ kind: 'shared', entity: person('Clint Eastwood'), rolesThere: ['lead'], rolesHere: ['director'] }, 'Dirty Harry', 'movie'),
    { key: 'next.reason.sharedDiffers', name: 'Clint Eastwood', there: 'lead', here: 'director', start: 'Dirty Harry' }
  )
  assert.deepEqual(
    reasonText(
      { kind: 'shared', entity: { ...person('Alien'), kind: 'franchise' }, rolesThere: ['franchise'], rolesHere: ['franchise'] },
      'Alien',
      'movie'
    ),
    { key: 'next.reason.franchise', name: 'Alien' }
  )
})

test('a favourite states the average only when the viewer rated some; the first place is said plainly', () => {
  assert.deepEqual(
    reasonText({ kind: 'favourite', entity: person('Kelly Reichardt'), rolesHere: ['director'], liked: 3, averageRating: 8.5 }, 'X', 'movie'),
    { key: 'next.reason.favouriteRated', name: 'Kelly Reichardt', role: 'director', count: 3, average: 8.5 }
  )
  assert.equal(
    reasonText({ kind: 'favourite', entity: person('K'), rolesHere: ['lead'], liked: 2, averageRating: null }, 'X', 'movie').key,
    'next.reason.favourite'
  )
  // A rank is among the suggestion's own type, so the wording names it.
  assert.equal(reasonText({ kind: 'feel', rank: 1 }, 'X', 'movie').key, 'next.reason.feelClosestMovie')
  assert.equal(reasonText({ kind: 'feel', rank: 4 }, 'X', 'series').key, 'next.reason.feelSeries')
  assert.equal(
    reasonText({ kind: 'company', entity: person('HBO'), finished: 5, ratio: 2.5 }, 'X', 'series').key,
    'next.reason.companySeries'
  )
})

test('the start in the address reads back lowercased, and anything malformed is no start', () => {
  const ref = 'movie:00000000-0000-4000-8000-00000000000A'
  assert.equal(readStartParam(new URLSearchParams({ title: ref })), ref.toLowerCase())
  assert.equal(readStartParam(new URLSearchParams('title=movie:42')), null)
  assert.equal(readStartParam(new URLSearchParams('')), null)
})
