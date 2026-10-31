import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECKLIST_PATH, MAX_IDS_PER_LIST, applyOnboardingPatch, checklistOnScreen, checklistPending } from './onboardingState'
import type { OnboardingSummary } from './onboarding-context'

// The same cases as core onboarding/rules.test.ts, so the copy on screen and
// the copy the server stores cannot drift apart unnoticed.

test('lists are unioned, so two tabs closing different tips both stick', () => {
  const first = applyOnboardingPatch({}, { hintsDismissed: ['home'] })
  assert.deepEqual(applyOnboardingPatch(first, { hintsDismissed: ['browse', 'home'] }).hintsDismissed, ['home', 'browse'])
})

test('a union past the cap keeps the newest ids', () => {
  const full = { seen: Array.from({ length: MAX_IDS_PER_LIST }, (_, i) => `s${i}`) }
  const next = applyOnboardingPatch(full, { seen: ['newest'] })
  assert.equal(next.seen?.length, MAX_IDS_PER_LIST)
  assert.equal(next.seen?.at(-1), 'newest')
  assert.equal(next.seen?.[0], 's1')
})

test('resetting tips clears tours and tips but keeps the welcome outcome and what was seen', () => {
  const state = { welcome: 'done' as const, toursSeen: ['home'], hintsDismissed: ['browse'], seen: ['insights'] }
  assert.deepEqual(applyOnboardingPatch(state, { resetTips: true }), { welcome: 'done', seen: ['insights'] })
})

test('reopening the checklist removes the dismissal rather than storing false', () => {
  assert.deepEqual(applyOnboardingPatch({ checklistDismissed: true }, { checklistDismissed: false }), {})
})

function summary(complete: boolean, state: OnboardingSummary['state'] = {}): OnboardingSummary {
  return { mode: 'offer', state, watchingEnabled: true, checklist: { complete, recommendations: 'pending', items: [] } }
}

test('the checklist is pending until it is complete or hidden, and never without an answer', () => {
  assert.equal(checklistPending(null), false)
  assert.equal(checklistPending(summary(false)), true)
  assert.equal(checklistPending(summary(true)), false)
  assert.equal(checklistPending(summary(false, { checklistDismissed: true })), false)
})

test('the checklist is on screen only on Home, so the floating tour offer shows everywhere else', () => {
  assert.equal(checklistOnScreen(summary(false), CHECKLIST_PATH), true)
  assert.equal(checklistOnScreen(summary(false), '/browse'), false)
  assert.equal(checklistOnScreen(summary(true), CHECKLIST_PATH), false)
})
