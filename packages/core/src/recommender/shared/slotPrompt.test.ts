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
  describeStanding,
  ownStandingAt,
  readOwnStanding,
  twinStandingBand,
  twinStandingLine,
  type SlotMarkers,
} from './explanationPrompt.js'

const RANKED: SlotMarkers = {}
const INTEREST: SlotMarkers = { interestText: 'slow cinema' }
const TWIN: SlotMarkers = { fromTasteTwin: true }
const ACCLAIMED: SlotMarkers = { fromAcclaimed: true }

test('a bare pick gets the causal heading, every reserved pick does not', () => {
  assert.equal(isReservedSlotPick(RANKED), false)
  assert.match(evidenceHeading(RANKED, MOVIE_NOUNS, true), new RegExp(EVIDENCE_HEADING_RANKED))

  for (const slot of [INTEREST, TWIN, ACCLAIMED]) {
    assert.equal(isReservedSlotPick(slot), true)
    const heading = evidenceHeading(slot, MOVIE_NOUNS, true)
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
    evidenceHeading(RANKED, MOVIE_NOUNS, true),
    evidenceHeading(TWIN, MOVIE_NOUNS, true),
  ].join('\n')

  for (const nouns of [MOVIE_NOUNS, SERIES_NOUNS]) {
    const rules = `${buildEvidenceRules(nouns)}\n${buildSlotRules(nouns)}`
    for (const heading of [EVIDENCE_HEADING_RANKED, EVIDENCE_HEADING_RESERVED]) {
      assert.ok(rules.includes(heading), `the rules never mention ${heading}`)
      assert.ok(emitted.includes(heading), `no pick ever emits ${heading}`)
    }
  }
})

test('a twin pick offers the shared titles as material, never as a bridge to build', () => {
  const line = buildSlotLines(
    { fromTasteTwin: true, twinSharedTitles: ['Stalker (1979)', 'Come and See (1985)'] },
    MOVIE_NOUNS
  )
  assert.match(line, /Stalker \(1979\)/)
  assert.match(line, /Come and See \(1985\)/)
  // The reason is the other viewer; the titles are the shared ones nearest the
  // pick, usable one at a time where the link is concrete.
  assert.match(line, /that is why it is in the list/)
  assert.match(line, /closest to this movie/)
  assert.match(line, /never link them to each other/)
  // The instruction that made the model invent "where those four meet".
  assert.doesNotMatch(line, /shared ground/)
  assert.doesNotMatch(line, /build the explanation on/)
})

test('the twin rule forbids a thread through the shared titles', () => {
  for (const nouns of [MOVIE_NOUNS, SERIES_NOUNS]) {
    const rules = buildSlotRules(nouns)
    assert.match(rules, /never invent a thread running through them/)
    assert.doesNotMatch(rules, /shared ground IS the reason/)
    assert.doesNotMatch(rules, /build the explanation on them/)
  }
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

// ============================================================================
// Distant evidence on a RANKED pick
// ============================================================================

test('a ranked pick whose evidence is far gets the non-causal heading', () => {
  // The failure this closes: storeEvidence has no distance floor, so a viewer
  // whose history holds nothing near the pick is still handed three rows, and
  // the model -- told to use the data and invent nothing -- writes a reason out
  // of them. Live, that is Das Boot at 0.67 explaining Metropolis.
  const heading = evidenceHeading(RANKED, MOVIE_NOUNS, false)
  assert.match(heading, new RegExp(EVIDENCE_HEADING_RESERVED))
  assert.doesNotMatch(heading, new RegExp(EVIDENCE_HEADING_RANKED))
})

test('a ranked pick with close evidence still states the cause', () => {
  // The guard must not simply demote everything -- that would be a different
  // way of saying nothing.
  const heading = evidenceHeading(RANKED, MOVIE_NOUNS, true)
  assert.match(heading, new RegExp(EVIDENCE_HEADING_RANKED))
})

test('close evidence cannot re-promote a reserved-slot pick', () => {
  // The two conditions are OR, not XOR. A twin pick whose evidence happens to
  // be near is still not explained by the ranking that rejected it.
  const heading = evidenceHeading(TWIN, MOVIE_NOUNS, true)
  assert.match(heading, new RegExp(EVIDENCE_HEADING_RESERVED))
})

test('the softened heading reuses the reserved label rather than inventing a third', () => {
  // Both rules in buildSlotRules are written against exactly two headings; a
  // third would need a third rule, and the model would have one more thing to
  // get wrong.
  const distantRanked = evidenceHeading(RANKED, MOVIE_NOUNS, false)
  const reserved = evidenceHeading(TWIN, MOVIE_NOUNS, true)
  assert.equal(distantRanked, reserved)
})

test('a twin pick that nearly made the list says so, with the numbers', () => {
  // Synecdoche, New York: a 90% taste match that came 26th against a list of
  // 20, explained as though the viewer's own taste had nothing to do with it.
  const line = twinStandingLine({ rank: 26, scored: 12451, listSize: 20 })
  assert.ok(line)
  assert.match(line, /#26 of 12,451 titles scored, against a list of 20/)
  assert.match(line, /nearly made the list by itself/)
  assert.match(line, /do not write as though their own taste had nothing to do with it/)
  // The pool size is for the model's judgement, never for the reader.
  assert.match(line, /Never quote the number of titles scored to the reader/)
})

test('the four standing bands', () => {
  const at = (rank: number) => twinStandingBand({ rank, scored: 12451, listSize: 20 })
  // Inside the list's range on score alone, passed over at selection.
  assert.equal(at(1), 'inside')
  assert.equal(at(20), 'inside')
  // Just outside: within twice the list.
  assert.equal(at(21), 'near')
  assert.equal(at(40), 'near')
  // Past that but inside the top 5% of the pool.
  assert.equal(at(41), 'strong')
  assert.equal(at(622), 'strong')
  // Everything else.
  assert.equal(at(623), 'far')

  assert.match(twinStandingLine({ rank: 8, scored: 12451, listSize: 20 }) ?? '', /inside the list's range by itself, but the selection passed it over/)
  assert.doesNotMatch(twinStandingLine({ rank: 8, scored: 12451, listSize: 20 }) ?? '', /nearly made/)
  assert.match(twinStandingLine({ rank: 41, scored: 12451, listSize: 20 }) ?? '', /strong match for them, but well outside/)
  assert.match(twinStandingLine({ rank: 623, scored: 12451, listSize: 20 }) ?? '', /essentially the whole reason/)
})

test('no standing, or a malformed one, adds nothing', () => {
  assert.equal(twinStandingLine(undefined), null)
  assert.equal(describeStanding(undefined), null)
  for (const standing of [
    { rank: 0, scored: 100, listSize: 20 },
    { rank: 5, scored: 0, listSize: 20 },
    { rank: Number.NaN, scored: 100, listSize: 20 },
    { rank: 2.5, scored: 100, listSize: 20 },
    // A rank past the pool: what a run whose stored pool was truncated gives.
    { rank: 150, scored: 100, listSize: 20 },
  ]) {
    assert.equal(twinStandingLine(standing), null, JSON.stringify(standing))
    assert.equal(twinStandingBand(standing), null, JSON.stringify(standing))
  }
})

test('ownStandingAt is the one constructor: an index, never a guessed rank', () => {
  assert.deepEqual(ownStandingAt(25, 12451, 20), { rank: 26, scored: 12451, listSize: 20 })
  // Not among the selectable titles.
  assert.equal(ownStandingAt(-1, 12451, 20), undefined)
  // Unusable counts.
  assert.equal(ownStandingAt(0, 0, 20), undefined)
  assert.equal(ownStandingAt(200, 100, 20), undefined)
})

test('readOwnStanding accepts only a well-formed stored standing', () => {
  assert.deepEqual(readOwnStanding({ rank: 3, scored: 10, listSize: 5 }), { rank: 3, scored: 10, listSize: 5 })
  for (const value of [null, 'x', {}, { rank: '3', scored: 10, listSize: 5 }, { rank: 11, scored: 10, listSize: 5 }]) {
    assert.equal(readOwnStanding(value), undefined, JSON.stringify(value))
  }
})

test('the checker gets the standing as a fact, without the writer’s instructions', () => {
  const fact = describeStanding({ rank: 26, scored: 12451, listSize: 20 })
  assert.equal(
    fact,
    'On its own score it ranked #26 of 12,451 titles scored, against a list of 20: just outside the list — it nearly made it by itself'
  )
  assert.doesNotMatch(fact ?? '', /Never quote|do not write/)
})

test('the standing rides in the twin line, with or without shared titles', () => {
  const ownStanding = { rank: 26, scored: 12451, listSize: 20 }
  const withTitles = buildSlotLines(
    { fromTasteTwin: true, twinSharedTitles: ['Anomalisa (2015)'], ownStanding },
    MOVIE_NOUNS
  )
  assert.match(withTitles, /that is why it is in the list, so lead with that\. On its own score it ranked #26/)
  assert.match(withTitles, /Anomalisa \(2015\)/)

  const bare = buildSlotLines({ fromTasteTwin: true, ownStanding }, MOVIE_NOUNS)
  assert.match(bare, /never name or describe that person\. On its own score it ranked #26/)

  // A pick that is not a twin pick never gets one, even if a standing leaks in.
  assert.equal(buildSlotLines({ ownStanding }, MOVIE_NOUNS), '')
})

test('an interest pick is introduced with the tags that back it, never "lead with that"', () => {
  const line = buildSlotLines(
    { interestText: 'dark comedy', interestEvidence: { strength: 'phrase', matched: ['dark comedy'] } },
    MOVIE_NOUNS
  )
  assert.match(line, /THEY ASKED FOR THIS/)
  assert.match(line, /own genres and keywords say so: "dark comedy"/)
  assert.match(line, /claim no more about the match than those tags say/)
  assert.doesNotMatch(line, /lead with that/)
})

test('an unconfirmed interest pick may only be called close to what was asked for', () => {
  // Runs from before evidence, whose title the refresh found no tag on: the
  // pick came from embedding nearness, which put a drama called Dark Horse
  // second for "dark comedy".
  const line = buildSlotLines({ interestText: 'dark comedy' }, SERIES_NOUNS)
  assert.match(line, /nothing in its genres or keywords confirms it is one/)
  assert.match(line, /never that it is one/)
})

test('the interest rule forbids claiming a borrowed trick the viewer "already loves"', () => {
  for (const nouns of [MOVIE_NOUNS, SERIES_NOUNS]) {
    const rules = buildSlotRules(nouns)
    assert.match(rules, /using the tags the marker names as the evidence/)
    assert.match(rules, /never say they "already love" a technique/)
  }
})
