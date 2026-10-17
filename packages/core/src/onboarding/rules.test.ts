import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_IDS_PER_LIST,
  RATINGS_GOAL,
  buildChecklist,
  decideOnboardingMode,
  mergeOnboardingState,
  readOnboardingPatch,
  readOnboardingState,
  type ChecklistFacts,
} from './rules.js'

const SHIPPED = new Date('2026-10-17T12:00:00Z')

test('a new account gets the tour, an existing one is only offered it', () => {
  assert.equal(
    decideOnboardingMode({ firstLoginAt: new Date('2026-10-18T09:00:00Z'), introducedAt: SHIPPED, state: {} }),
    'tour'
  )
  assert.equal(
    decideOnboardingMode({ firstLoginAt: new Date('2025-03-01T09:00:00Z'), introducedAt: SHIPPED, state: {} }),
    'offer'
  )
})

test('anything recorded about the welcome tour ends both the tour and the offer', () => {
  const late = new Date('2026-10-18T09:00:00Z')
  assert.equal(decideOnboardingMode({ firstLoginAt: late, introducedAt: SHIPPED, state: { welcome: 'done' } }), 'none')
  assert.equal(decideOnboardingMode({ firstLoginAt: null, introducedAt: SHIPPED, state: { welcome: 'dismissed' } }), 'none')
})

test('an unknown date reads as an existing account, never a forced tour', () => {
  assert.equal(decideOnboardingMode({ firstLoginAt: null, introducedAt: SHIPPED, state: {} }), 'offer')
  assert.equal(decideOnboardingMode({ firstLoginAt: new Date(), introducedAt: null, state: {} }), 'offer')
})

test('a patch is refused, not trimmed, when any part of it is malformed', () => {
  assert.ok('error' in readOnboardingPatch({ welcome: 'maybe' }))
  assert.ok('error' in readOnboardingPatch({ hintsDismissed: ['ok', 'Not An Id'] }))
  assert.ok('error' in readOnboardingPatch({ toursSeen: 'home' }))
  assert.ok('error' in readOnboardingPatch({ somethingElse: true }))
  assert.ok('error' in readOnboardingPatch({ hintsDismissed: Array.from({ length: MAX_IDS_PER_LIST + 1 }, (_, i) => `h${i}`) }))
  assert.ok('error' in readOnboardingPatch(null))
  assert.ok('error' in readOnboardingPatch(['home']))
})

test('a valid patch is read whole, with repeated ids folded', () => {
  const result = readOnboardingPatch({ welcome: 'done', hintsDismissed: ['home', 'home', 'browse'], resetTips: false })
  assert.deepEqual(result, { patch: { welcome: 'done', hintsDismissed: ['home', 'browse'], resetTips: false } })
})

test('lists are unioned, so two tabs dismissing different hints both stick', () => {
  const first = mergeOnboardingState({}, { hintsDismissed: ['home'] })
  const second = mergeOnboardingState(first, { hintsDismissed: ['browse', 'home'] })
  assert.deepEqual(second.hintsDismissed, ['home', 'browse'])
})

test('a union past the cap keeps the newest ids', () => {
  const full = { seen: Array.from({ length: MAX_IDS_PER_LIST }, (_, i) => `s${i}`) }
  const next = mergeOnboardingState(full, { seen: ['newest'] })
  assert.equal(next.seen?.length, MAX_IDS_PER_LIST)
  assert.equal(next.seen?.at(-1), 'newest')
  assert.equal(next.seen?.[0], 's1')
})

test('resetting tips clears tours and hints but keeps the welcome outcome and what was seen', () => {
  const state = { welcome: 'done' as const, toursSeen: ['home'], hintsDismissed: ['browse'], seen: ['insights'] }
  assert.deepEqual(mergeOnboardingState(state, { resetTips: true }), { welcome: 'done', seen: ['insights'] })
})

test('reopening the checklist removes the dismissal rather than storing false', () => {
  assert.deepEqual(mergeOnboardingState({ checklistDismissed: true }, { checklistDismissed: false }), {})
})

test('a stored state with malformed fields loses those fields only', () => {
  assert.deepEqual(readOnboardingState({ welcome: 'bogus', toursSeen: ['home'], hintsDismissed: 'x', seen: [1] }), {
    toursSeen: ['home'],
  })
  assert.deepEqual(readOnboardingState(null), {})
  assert.deepEqual(readOnboardingState('nope'), {})
})

const NOTHING: ChecklistFacts = {
  playedTitles: 0,
  ratings: 0,
  interests: 0,
  conversations: 0,
  watchingSeries: 0,
  hasRecommendations: false,
  receivesRecommendations: true,
}

test('a brand-new account has every item to do and its picks pending', () => {
  const checklist = buildChecklist(NOTHING, {}, { assistant: true, watching: true })
  assert.deepEqual(
    checklist.items.map((i) => i.id),
    ['watch', 'rate', 'interest', 'why', 'assistant', 'watching']
  )
  assert.ok(checklist.items.every((i) => !i.done))
  assert.equal(checklist.complete, false)
  assert.equal(checklist.recommendations, 'pending')
})

test('an item for a feature the person does not have is not listed at all', () => {
  const ids = buildChecklist(NOTHING, {}, { assistant: false, watching: false }).items.map((i) => i.id)
  assert.deepEqual(ids, ['watch', 'rate', 'interest', 'why'])
})

test('rating counts toward the goal and stops at it', () => {
  const partway = buildChecklist({ ...NOTHING, ratings: 2 }, {}, { assistant: false, watching: false })
  assert.deepEqual(partway.items.find((i) => i.id === 'rate'), { id: 'rate', done: false, progress: 2, goal: RATINGS_GOAL })
  const past = buildChecklist({ ...NOTHING, ratings: 40 }, {}, { assistant: false, watching: false })
  assert.deepEqual(past.items.find((i) => i.id === 'rate'), { id: 'rate', done: true, progress: RATINGS_GOAL, goal: RATINGS_GOAL })
})

test('the "why" item is done by what the browser saw, everything else by the record', () => {
  const checklist = buildChecklist(
    { ...NOTHING, playedTitles: 3, ratings: 5, interests: 1, hasRecommendations: true },
    { seen: ['insights'] },
    { assistant: false, watching: false }
  )
  assert.equal(checklist.complete, true)
  assert.equal(checklist.recommendations, 'ready')
})

test('an account that gets no recommendations is told so, not that they are coming', () => {
  const checklist = buildChecklist({ ...NOTHING, receivesRecommendations: false }, {}, { assistant: false, watching: false })
  assert.equal(checklist.recommendations, 'off')
})
