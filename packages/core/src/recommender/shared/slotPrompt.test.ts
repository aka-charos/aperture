import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceRules,
  buildSlotLines,
  buildSlotRules,
  evidenceHeading,
  EVIDENCE_HEADING_RANKED,
  EVIDENCE_HEADING_RESERVED,
  isReservedSlotPick,
  MOVIE_NOUNS,
  SERIES_NOUNS,
  TWIN_SHARED_TITLE_LIMIT,
  type SlotMarkers,
} from './explanationPrompt.js'

const RANKED: SlotMarkers = {}
const INTEREST: SlotMarkers = { interestText: 'slow cinema' }
const TWIN: SlotMarkers = { fromTasteTwin: true }
const ACCLAIMED: SlotMarkers = { fromAcclaimed: true }

test('a bare pick gets the causal heading, every reserved pick does not', () => {
  assert.equal(isReservedSlotPick(RANKED), false)
  assert.match(evidenceHeading(RANKED, MOVIE_NOUNS), new RegExp(EVIDENCE_HEADING_RANKED))

  for (const slot of [INTEREST, TWIN, ACCLAIMED]) {
    assert.equal(isReservedSlotPick(slot), true)
    const heading = evidenceHeading(slot, MOVIE_NOUNS)
    assert.match(heading, new RegExp(EVIDENCE_HEADING_RESERVED))
    assert.doesNotMatch(
      heading,
      new RegExp(EVIDENCE_HEADING_RANKED),
      'a reserved pick must never be labelled as the thing similarity chose'
    )
  }
})

test('the rules only name headings the picks can actually carry', () => {
  // The whole failure this fixes was a rule pointing at one label while the
  // picks carried another, so the rule never fired. Any rename has to move
  // both, and this is what forces that.
  const emitted = [
    evidenceHeading(RANKED, MOVIE_NOUNS),
    evidenceHeading(TWIN, MOVIE_NOUNS),
  ].join('\n')

  for (const nouns of [MOVIE_NOUNS, SERIES_NOUNS]) {
    const rules = `${buildEvidenceRules(nouns)}\n${buildSlotRules(nouns)}`
    for (const heading of [EVIDENCE_HEADING_RANKED, EVIDENCE_HEADING_RESERVED]) {
      assert.ok(rules.includes(heading), `the rules never mention ${heading}`)
      assert.ok(emitted.includes(heading), `no pick ever emits ${heading}`)
    }
  }
})

test('a twin pick is explained by the shared titles when it has them', () => {
  const line = buildSlotLines(
    { fromTasteTwin: true, twinSharedTitles: ['Stalker (1979)', 'Come and See (1985)'] },
    MOVIE_NOUNS
  )
  assert.match(line, /Stalker \(1979\)/)
  assert.match(line, /Come and See \(1985\)/)
  assert.match(line, /shared ground is the reason/)
})

test('a twin pick from an older run falls back to the anonymous line', () => {
  // Runs predating score_breakdown.twinMatch.sharedIds carry the flag alone.
  for (const slot of [TWIN, { fromTasteTwin: true, twinSharedTitles: [] }]) {
    const line = buildSlotLines(slot, MOVIE_NOUNS)
    assert.match(line, /A KINDRED VIEWER PICKED THIS/)
    assert.match(line, /never name or describe/)
    assert.doesNotMatch(line, /shared ground/)
  }
})

test('the shared-title list is capped', () => {
  const many = Array.from({ length: TWIN_SHARED_TITLE_LIMIT + 4 }, (_, i) => `Film ${i}`)
  const line = buildSlotLines({ fromTasteTwin: true, twinSharedTitles: many }, MOVIE_NOUNS)

  assert.match(line, /Film 0/)
  assert.doesNotMatch(line, new RegExp(`Film ${TWIN_SHARED_TITLE_LIMIT}\\b`))
})

test('a pick can hold more than one marker and every one is stated', () => {
  const line = buildSlotLines(
    { interestText: 'westerns', fromTasteTwin: true, fromAcclaimed: true },
    MOVIE_NOUNS
  )
  assert.match(line, /THEY ASKED FOR THIS/)
  assert.match(line, /A KINDRED VIEWER PICKED THIS/)
  assert.match(line, /WIDELY ACCLAIMED/)
})

test('a ranked pick carries no marker line at all', () => {
  assert.equal(buildSlotLines(RANKED, MOVIE_NOUNS), '')
})

test('every reserved-slot rule makes the evidence conditional, never mandatory', () => {
  // The bug was an unconditional "MUST reference the specific watched movies"
  // that the per-slot rules then tried to soften with "then use as support".
  // All three now say the same thing: only if it genuinely fits.
  for (const nouns of [MOVIE_NOUNS, SERIES_NOUNS]) {
    const rules = buildSlotRules(nouns)
    assert.equal(
      (rules.match(/genuinely fit/g) ?? []).length,
      3,
      'each of the three reserved-slot rules must gate the evidence'
    )
    assert.doesNotMatch(rules, /then use the similarity evidence as support/)
    assert.doesNotMatch(rules, /then fill in with the similarity evidence/)
  }
})

test('the movie and series rules differ only in their nouns', () => {
  const movie = buildSlotRules(MOVIE_NOUNS)
  const series = buildSlotRules(SERIES_NOUNS)

  assert.notEqual(movie, series)
  assert.equal(
    movie.replace(/\bmovies\b/g, 'X').replace(/\bmovie\b/g, 'Y'),
    series.replace(/\bseries\b/g, 'X').replace(/\bshow\b/g, 'Y'),
    'the two prompts have drifted beyond their media nouns'
  )
})
