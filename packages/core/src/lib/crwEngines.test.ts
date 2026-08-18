import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENGINE_COOLDOWN_MS,
  ENGINE_FAILURE_LIMIT,
  engineHealthSnapshot,
  orderByHealth,
  recordEngineOutcome,
  resetEngineHealth,
} from './crwEngines.js'

const CASCADE = ['google', 'duckduckgo', 'bing'] as const
const cascade = () => [...CASCADE]

test('an untouched cascade keeps the order the operator configured', () => {
  resetEngineHealth()
  // That order is a preference about result quality. Nothing here may reorder
  // it except a demonstrated failure.
  assert.deepEqual(orderByHealth(cascade()), ['google', 'duckduckgo', 'bing'])
})

test('four failures are not enough — one hard title must not park an engine', () => {
  resetEngineHealth()
  // CRW answers `200 {results: []}` both for a bot wall and for a title the web
  // genuinely has nothing on, so a handful of empties has to stay ambiguous.
  for (let i = 0; i < ENGINE_FAILURE_LIMIT - 1; i++) recordEngineOutcome('google', false)
  assert.deepEqual(orderByHealth(cascade()), ['google', 'duckduckgo', 'bing'])
})

test('five in a row moves it to the back, and the rest keep their order', () => {
  resetEngineHealth()
  for (let i = 0; i < ENGINE_FAILURE_LIMIT; i++) recordEngineOutcome('google', false)
  assert.deepEqual(orderByHealth(cascade()), ['duckduckgo', 'bing', 'google'])
})

test('a parked engine is never dropped, even when every engine is parked', () => {
  resetEngineHealth()
  // Filtering could empty the list, and an empty list is not "no engines" — CRW
  // falls back to its own default, which is Google alone. That is the exact
  // state the cascade exists to escape, so reordering is the only safe move.
  for (const engine of CASCADE) {
    for (let i = 0; i < ENGINE_FAILURE_LIMIT; i++) recordEngineOutcome(engine, false)
  }
  assert.deepEqual(orderByHealth(cascade()).sort(), cascade().sort())
  assert.equal(orderByHealth(cascade()).length, 3)
})

test('any answer clears the count, so failures have to be consecutive', () => {
  resetEngineHealth()
  for (let i = 0; i < ENGINE_FAILURE_LIMIT - 1; i++) recordEngineOutcome('google', false)
  recordEngineOutcome('google', true)
  for (let i = 0; i < ENGINE_FAILURE_LIMIT - 1; i++) recordEngineOutcome('google', false)
  assert.deepEqual(orderByHealth(cascade()), ['google', 'duckduckgo', 'bing'])
})

test('an answer un-parks an engine outright', () => {
  resetEngineHealth()
  for (let i = 0; i < ENGINE_FAILURE_LIMIT; i++) recordEngineOutcome('google', false)
  recordEngineOutcome('google', true)
  assert.deepEqual(engineHealthSnapshot(), {})
  assert.deepEqual(orderByHealth(cascade()), ['google', 'duckduckgo', 'bing'])
})

test('the park expires on its own, so a lifted block needs no intervention', () => {
  resetEngineHealth()
  const t0 = 1_000_000
  for (let i = 0; i < ENGINE_FAILURE_LIMIT; i++) recordEngineOutcome('google', false, t0)

  assert.deepEqual(orderByHealth(cascade(), t0 + ENGINE_COOLDOWN_MS - 1), [
    'duckduckgo',
    'bing',
    'google',
  ])
  // Expiry rather than a permanent park: nobody should have to remember to put
  // a setting back after Google stops walling them.
  assert.deepEqual(orderByHealth(cascade(), t0 + ENGINE_COOLDOWN_MS + 1), [
    'google',
    'duckduckgo',
    'bing',
  ])
})

test('the snapshot is a copy, not a live handle on the map', () => {
  resetEngineHealth()
  recordEngineOutcome('bing', false)
  const snap = engineHealthSnapshot()
  snap.bing.failures = 99
  assert.equal(engineHealthSnapshot().bing.failures, 1)
})
