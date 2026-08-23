import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAcclaimed,
  computeReservedAcclaimedSlots,
  pickAcclaimedSlotFillers,
} from './acclaimedSlots.js'

const R = 8.3
const V = 50000

test('the gate needs BOTH a high rating and a verified one', () => {
  assert.equal(isAcclaimed(9.3, 2_900_000, R, V), true)
  // The live case that motivated the vote floor: a 9.3 on 13,250 votes was
  // being picked by 7 of 9 users at average rank 4.
  assert.equal(isAcclaimed(9.3, 13_250, R, V), false)
  assert.equal(isAcclaimed(7.9, 900_000, R, V), false)
})

test('an unverifiable reputation fails rather than passes', () => {
  // Null votes is exactly the case the gate exists to exclude, so it must not
  // fall through to "rating alone".
  assert.equal(isAcclaimed(9.5, null, R, V), false)
  assert.equal(isAcclaimed(null, 900_000, R, V), false)
  assert.equal(isAcclaimed(9.5, undefined, R, V), false)
  assert.equal(isAcclaimed(NaN, 900_000, R, V), false)
})

test('the floors are inclusive, so a threshold set to a real value admits it', () => {
  assert.equal(isAcclaimed(8.3, 50_000, R, V), true)
  assert.equal(isAcclaimed(8.29, 50_000, R, V), false)
  assert.equal(isAcclaimed(8.3, 49_999, R, V), false)
})

test('zero slots disables the feature, which is the default', () => {
  assert.equal(computeReservedAcclaimedSlots(20, 500, 0), 0)
  assert.equal(computeReservedAcclaimedSlots(20, 500, -1), 0)
})

test('slots are bounded by the ceiling, the pool and the room left', () => {
  assert.equal(computeReservedAcclaimedSlots(20, 500, 4), 4)
  assert.equal(computeReservedAcclaimedSlots(20, 2, 4), 2, 'only two eligible titles exist')
  assert.equal(computeReservedAcclaimedSlots(3, 500, 4), 3, 'only three picks left to give')
  assert.equal(computeReservedAcclaimedSlots(0, 500, 4), 0)
})

test('the three slot features together can never exceed the budget', () => {
  // remainingCount is what interests and twins left behind, so a sweep over
  // every combination must stay inside selectedCount.
  for (let selected = 1; selected <= 20; selected++) {
    for (let interests = 0; interests <= 10; interests++) {
      for (let twins = 0; twins <= 10; twins++) {
        const i = Math.min(interests, selected)
        const t = Math.min(twins, selected - i)
        const a = computeReservedAcclaimedSlots(selected - i - t, 500, 10)
        assert.ok(i + t + a <= selected, `${i}+${t}+${a} > ${selected}`)
      }
    }
  }
})

const c = (id: string, finalScore: number) => ({ id, finalScore })

test('fillers are ordered by the viewers own score, never by rating', () => {
  // The whole point: an acclaim-ordered list would hand every user on the
  // instance the same titles. finalScore is what makes it personal.
  const eligible = [c('a', 0.42), c('b', 0.81), c('c', 0.63)]
  assert.deepEqual(
    pickAcclaimedSlotFillers([], eligible, 2).map((x) => x.id),
    ['b', 'c']
  )
})

test('a title already selected does not take a second slot', () => {
  const eligible = [c('a', 0.9), c('b', 0.8)]
  assert.deepEqual(
    pickAcclaimedSlotFillers([c('a', 0.9)], eligible, 2).map((x) => x.id),
    ['b']
  )
})

test('an empty eligible pool leaves the slots unused rather than padding', () => {
  assert.deepEqual(pickAcclaimedSlotFillers([], [], 4), [])
  assert.equal(pickAcclaimedSlotFillers([c('a', 0.5)], [c('a', 0.5)], 4).length, 0)
})

test('ties break deterministically on id', () => {
  const eligible = [c('z', 0.5), c('a', 0.5), c('m', 0.5)]
  assert.deepEqual(
    pickAcclaimedSlotFillers([], eligible, 2).map((x) => x.id),
    ['a', 'm']
  )
})

test('the input array is not reordered under the caller', () => {
  // scoredCandidates is the run's ranked pool and is read again afterwards.
  const eligible = [c('a', 0.1), c('b', 0.9)]
  pickAcclaimedSlotFillers([], eligible, 1)
  assert.deepEqual(eligible.map((x) => x.id), ['a', 'b'])
})
