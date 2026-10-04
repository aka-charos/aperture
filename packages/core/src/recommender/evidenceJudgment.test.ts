import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceJudgmentRequest,
  judgmentKey,
  readEvidenceJudgments,
  summarizeEvidenceJudgments,
  JUDGMENT_SYNOPSIS_CHARS,
  type JudgedEvidenceRow,
  type JudgedTitleFacts,
} from './evidenceJudgment.js'
import {
  EVIDENCE_CAUSAL_MIN_COSINE,
  EVIDENCE_JUDGMENT_MIN_YES,
  evidenceSupportsCause,
} from './evidenceStrength.js'

const FURIOSA: JudgedTitleFacts = {
  title: 'Furiosa: A Mad Max Saga',
  year: 2024,
  genres: ['Action', 'Science Fiction'],
  creators: ['George Miller'],
  franchise: 'Mad Max Collection',
  themes: ['post-apocalyptic', 'desert', 'revenge'],
  synopsis: 'A young woman is taken from her home and fights her way back across the wasteland.',
}
const MAD_MAX: JudgedTitleFacts = {
  title: 'Mad Max: Fury Road',
  year: 2015,
  genres: ['Action', 'Science Fiction'],
  creators: ['George Miller'],
  franchise: 'Mad Max Collection',
  themes: ['post-apocalyptic', 'desert', 'chase'],
  synopsis: 'A drifter and a rebel warrior flee a tyrant across the desert.',
}
const NO_FACTS: JudgedTitleFacts = {
  title: 'Untitled',
  year: null,
  genres: [],
  creators: [],
  themes: [],
  synopsis: null,
}

// ---------------------------------------------------------------- the request

test('one question per evidence title, keyed in order', () => {
  const request = buildEvidenceJudgmentRequest(FURIOSA, [MAD_MAX, NO_FACTS], 'movie')
  assert.deepEqual(request.keys, ['w1', 'w2'])
  assert.deepEqual(Object.keys(request.questions), ['w1', 'w2'])
  assert.deepEqual(Object.keys(request.state.watched as object), ['w1', 'w2'])
  assert.equal(judgmentKey(2), 'w3')
})

test('every question is a yes/no with criteria, naming both titles', () => {
  const request = buildEvidenceJudgmentRequest(FURIOSA, [MAD_MAX], 'movie')
  const question = request.questions.w1
  assert.equal(question.type, 'noul')
  assert.ok(question.criteria?.true && question.criteria?.false)
  // Named, not only keyed: a model that does not resolve state paths still
  // knows which two films it is comparing.
  assert.match(question.instructions, /Furiosa: A Mad Max Saga/)
  assert.match(question.instructions, /Mad Max: Fury Road/)
  // The boundary the cosine bar cannot draw is spelled out.
  assert.match(question.instructions, /broad genre/)
})

test('the franchise and the director reach the state, because they are the strongest signals', () => {
  const request = buildEvidenceJudgmentRequest(FURIOSA, [MAD_MAX], 'movie')
  const recommended = request.state.recommended as Record<string, unknown>
  assert.equal(recommended.franchise, 'Mad Max Collection')
  assert.deepEqual(recommended.directedBy, ['George Miller'])
})

test('a series names its creators, not directors', () => {
  const request = buildEvidenceJudgmentRequest(FURIOSA, [MAD_MAX], 'series')
  const recommended = request.state.recommended as Record<string, unknown>
  assert.deepEqual(recommended.createdBy, ['George Miller'])
  assert.equal(recommended.directedBy, undefined)
  assert.match(request.questions.w1.instructions, /same creator/)
})

test('absent facts are left out, never invented as empty values', () => {
  const request = buildEvidenceJudgmentRequest(FURIOSA, [NO_FACTS], 'movie')
  const watched = (request.state.watched as Record<string, Record<string, unknown>>).w1
  assert.deepEqual(Object.keys(watched), ['title'])
})

test('a long synopsis is clipped so four titles stay far inside an 8k context', () => {
  const long = { ...MAD_MAX, synopsis: 'word '.repeat(1000) }
  const request = buildEvidenceJudgmentRequest(FURIOSA, [long], 'movie')
  const watched = (request.state.watched as Record<string, Record<string, unknown>>).w1
  assert.ok(String(watched.synopsis).length <= JUDGMENT_SYNOPSIS_CHARS + 1)
  assert.ok(JSON.stringify(request).length < 12_000)
})

// ----------------------------------------------------------------- the answer

test('verdicts come back in key order', () => {
  const answers = {
    w2: { type: 'noul', noul: 0.1 },
    w1: { type: 'noul', noul: 0.9 },
  }
  assert.deepEqual(readEvidenceJudgments(answers, ['w1', 'w2']), [0.9, 0.1])
})

test('a pick is all or nothing: one missing or malformed verdict discards the set', () => {
  const keys = ['w1', 'w2', 'w3']
  assert.equal(readEvidenceJudgments({ w1: { noul: 0.9 }, w2: { noul: 0.2 } }, keys), null)
  assert.equal(
    readEvidenceJudgments({ w1: { noul: 0.9 }, w2: { noul: 0.2 }, w3: { noul: '0.4' } }, keys),
    null
  )
  assert.equal(readEvidenceJudgments(null, keys), null)
  assert.equal(readEvidenceJudgments({}, []), null)
})

// ---------------------------------------------------------- the read decision

test('without verdicts the heading is exactly the cosine bar, as before', () => {
  const close = [{ similarity: EVIDENCE_CAUSAL_MIN_COSINE + 0.05 }]
  const far = [{ similarity: EVIDENCE_CAUSAL_MIN_COSINE - 0.05 }]
  assert.equal(evidenceSupportsCause(close), true)
  assert.equal(evidenceSupportsCause(far), false)
  // Absent and null both mean "not judged", never "judged no".
  assert.equal(evidenceSupportsCause([{ similarity: 0.8, judgedConnection: null }]), true)
})

test('a full set of verdicts overrides the bar in both directions', () => {
  // Die Hard -> Live Free or Die Hard: 0.680, under the bar, same franchise.
  assert.equal(
    evidenceSupportsCause([
      { similarity: 0.68, judgedConnection: 0.94 },
      { similarity: 0.66, judgedConnection: 0.12 },
    ]),
    true
  )
  // Children of Men -> Inception: 0.737, over the bar, looser than it looks.
  assert.equal(
    evidenceSupportsCause([
      { similarity: 0.737, judgedConnection: 0.2 },
      { similarity: 0.71, judgedConnection: 0.3 },
    ]),
    false
  )
})

test('a partial set of verdicts falls back to the bar rather than mixing the two', () => {
  assert.equal(
    evidenceSupportsCause([
      { similarity: 0.8, judgedConnection: 0.1 },
      { similarity: 0.6, judgedConnection: null },
    ]),
    true
  )
})

test('verdicts may arrive as text and still compare as numbers', () => {
  assert.equal(evidenceSupportsCause([{ similarity: '0.6', judgedConnection: '0.9' }]), true)
  assert.equal(evidenceSupportsCause([{ similarity: '0.9', judgedConnection: '0.1' }]), false)
})

test('the line is the model own boundary, and the boundary is a yes', () => {
  assert.equal(EVIDENCE_JUDGMENT_MIN_YES, 0.5)
  assert.equal(evidenceSupportsCause([{ similarity: 0, judgedConnection: 0.5 }]), true)
  assert.equal(evidenceSupportsCause([{ similarity: 1, judgedConnection: 0.4999 }]), false)
})

// ------------------------------------------------------------ the read-back

function row(
  candidateId: string,
  similarity: number,
  judgedConnection: number | null,
  evidenceTitle = 'E'
): JudgedEvidenceRow {
  return { candidateId, mediaType: 'movie', pickTitle: `P${candidateId}`, evidenceTitle, similarity, judgedConnection }
}

test('the summary counts agreement and each direction of disagreement', () => {
  const summary = summarizeEvidenceJudgments([
    // Agree: both yes.
    row('a', 0.8, 0.9),
    // Judge only: under the bar, model says yes.
    row('b', 0.68, 0.95, 'Die Hard'),
    row('b', 0.66, 0.1),
    // Cosine only: over the bar, model says no.
    row('c', 0.74, 0.2),
    // Not judged: counted as a pick, not as a judged one.
    row('d', 0.9, null),
  ])
  assert.equal(summary.picks, 4)
  assert.equal(summary.judgedPicks, 3)
  assert.equal(summary.agree, 1)
  assert.equal(summary.judgeOnly, 1)
  assert.equal(summary.cosineOnly, 1)
  assert.equal(summary.examples.length, 2)
  // The example names the row that drove the model's answer.
  const judgeOnly = summary.examples.find((e) => e.judgeSupports)
  assert.equal(judgeOnly?.evidenceTitle, 'Die Hard')
})

test('the example list is capped', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(String(i), 0.8, 0.1))
  assert.equal(summarizeEvidenceJudgments(rows, 5).examples.length, 5)
})
