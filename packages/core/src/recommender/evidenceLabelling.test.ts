import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isEvidenceLabel,
  isLabellingMediaType,
  judgeGroup,
  labellingOrder,
  mergeViewerRows,
  pairKey,
  tallyLabelledPairs,
  type TalliedPair,
} from './evidenceLabelling.js'

// ------------------------------------------------------------------ grouping

test('three judges that agree are unanimous, and a split has exactly one odd one out', () => {
  assert.equal(judgeGroup(true, true, true), 'unanimous')
  assert.equal(judgeGroup(false, false, false), 'unanimous')
  // threshold, rule, model
  assert.equal(judgeGroup(false, false, true), 'modelAlone')
  assert.equal(judgeGroup(true, true, false), 'modelAlone')
  assert.equal(judgeGroup(true, false, false), 'thresholdAlone')
  assert.equal(judgeGroup(false, true, true), 'thresholdAlone')
  assert.equal(judgeGroup(true, false, true), 'ruleAlone')
  assert.equal(judgeGroup(false, true, false), 'ruleAlone')
})

// ------------------------------------------------------------- blind order

test('the queue order is fixed per pair and unrelated to any verdict', () => {
  const key = pairKey('movie', 'a', 'b')
  assert.equal(labellingOrder(key), labellingOrder(key))
  assert.notEqual(labellingOrder(pairKey('movie', 'a', 'b')), labellingOrder(pairKey('movie', 'b', 'a')))
  assert.notEqual(labellingOrder(pairKey('movie', 'a', 'b')), labellingOrder(pairKey('series', 'a', 'b')))
  // Unsigned 32-bit, so a plain numeric sort is a total order.
  const order = labellingOrder(key)
  assert.ok(Number.isInteger(order) && order >= 0 && order < 2 ** 32)
})

// ------------------------------------------------------------------ merging

test('the same pair across viewers is one pair, counted per viewer', () => {
  const merged = mergeViewerRows([
    { mediaType: 'series', pickId: 'p', watchedId: 'w', similarity: '0.7840', judgedConnection: 0.4 },
    { mediaType: 'series', pickId: 'p', watchedId: 'w', similarity: '0.7840', judgedConnection: 0.44 },
    { mediaType: 'series', pickId: 'p', watchedId: 'other', similarity: 0.7, judgedConnection: 0.1 },
  ])
  assert.equal(merged.length, 2)
  const pair = merged.find((m) => m.watchedId === 'w')
  assert.ok(pair)
  assert.equal(pair.viewers, 2)
  // NUMERIC text still reads as a number.
  assert.equal(pair.similarity, 0.784)
  assert.ok(Math.abs((pair.modelP ?? 0) - 0.42) < 1e-9)
})

test('a pair with no readable verdict carries none, never a zero', () => {
  const [pair] = mergeViewerRows([
    { mediaType: 'movie', pickId: 'p', watchedId: 'w', similarity: null, judgedConnection: 'x' },
  ])
  assert.equal(pair.modelP, null)
  assert.equal(pair.similarity, null)
})

// ------------------------------------------------------------------ scoring

const pair = (over: Partial<TalliedPair>): TalliedPair => ({
  label: 'yes',
  thresholdSays: true,
  ruleSays: true,
  ruleBasis: 'director',
  modelSays: true,
  ...over,
})

test('labels score all three judges, arguable and unlabelled pairs never count', () => {
  const tally = tallyLabelledPairs([
    pair({}),
    // 1923 <- Tulsa King before creators were known: a reason only the threshold saw.
    pair({ ruleSays: false, ruleBasis: null, modelSays: false }),
    // Deadpool & Wolverine <- Dune: Part Two: the threshold alone said reason.
    pair({ label: 'no', ruleSays: false, ruleBasis: null, modelSays: false }),
    pair({ label: 'arguable' }),
    pair({ label: null }),
  ])
  assert.equal(tally.labelled, 4)
  assert.equal(tally.arguable, 1)
  assert.deepEqual(tally.all, { scored: 3, thresholdRight: 2, ruleRight: 2, modelRight: 2 })
  assert.deepEqual(tally.noSharedCredits, { scored: 2, thresholdRight: 1, ruleRight: 1, modelRight: 1 })
})

test('a pair a judge could not answer is not scored for anyone', () => {
  const tally = tallyLabelledPairs([pair({ thresholdSays: null })])
  assert.equal(tally.labelled, 1)
  assert.equal(tally.all.scored, 0)
})

test('only the three labels and the two media types are accepted', () => {
  assert.ok(isEvidenceLabel('yes') && isEvidenceLabel('no') && isEvidenceLabel('arguable'))
  assert.ok(!isEvidenceLabel('maybe') && !isEvidenceLabel(null))
  assert.ok(isLabellingMediaType('movie') && isLabellingMediaType('series'))
  assert.ok(!isLabellingMediaType('movies'))
})
