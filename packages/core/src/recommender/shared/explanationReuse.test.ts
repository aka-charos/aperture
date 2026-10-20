import test from 'node:test'
import assert from 'node:assert/strict'
import {
  explanationFingerprint,
  splitReusable,
  type ExplanationInputs,
  type StoredExplanation,
} from './explanationReuse.js'

const base: ExplanationInputs = {
  writer: '{"provider":"openrouter","model":"x/y"}',
  system: 'You are an expert film curator.',
  userContext: 'Top genres: Drama, Thriller',
  pick: '"Heat" (1995)\n   Genres: Crime',
}

test('the same inputs give the same fingerprint', () => {
  assert.equal(explanationFingerprint(base), explanationFingerprint({ ...base }))
})

test('every piece of the prompt moves the fingerprint', () => {
  const original = explanationFingerprint(base)
  for (const key of ['writer', 'system', 'userContext', 'pick'] as const) {
    const changed = explanationFingerprint({ ...base, [key]: `${base[key]} ` })
    assert.notEqual(changed, original, `${key} must be part of the fingerprint`)
  }
})

test('text moved from one piece to the next is a different prompt', () => {
  // Without the length prefix these two concatenate to the same string.
  const a = explanationFingerprint({ ...base, system: 'ab', userContext: 'c' })
  const b = explanationFingerprint({ ...base, system: 'a', userContext: 'bc' })
  assert.notEqual(a, b)
})

interface Pick {
  id: string
  fp: string
}

const split = (picks: Pick[], stored: Map<string, StoredExplanation>) =>
  splitReusable(
    picks,
    (p) => p.id,
    (p) => p.fp,
    stored
  )

test('a matching fingerprint reuses the stored text', () => {
  const stored = new Map([['a', { fingerprint: 'f1', explanation: 'Because of Heat.' }]])
  const { reused, toWrite } = split([{ id: 'a', fp: 'f1' }], stored)
  assert.deepEqual(
    reused.map((r) => [r.pick.id, r.explanation]),
    [['a', 'Because of Heat.']]
  )
  assert.equal(toWrite.length, 0)
})

test('a changed fingerprint, a missing row or empty text is written again', () => {
  const stored = new Map([
    ['changed', { fingerprint: 'old', explanation: 'Old text.' }],
    ['blank', { fingerprint: 'f', explanation: '   ' }],
  ])
  const { reused, toWrite } = split(
    [
      { id: 'changed', fp: 'new' },
      { id: 'missing', fp: 'f' },
      { id: 'blank', fp: 'f' },
    ],
    stored
  )
  assert.equal(reused.length, 0)
  assert.deepEqual(
    toWrite.map((p) => p.id),
    ['changed', 'missing', 'blank']
  )
})

test('the split keeps list order on both sides', () => {
  const stored = new Map([
    ['b', { fingerprint: 'fb', explanation: 'B.' }],
    ['d', { fingerprint: 'fd', explanation: 'D.' }],
  ])
  const { reused, toWrite } = split(
    ['a', 'b', 'c', 'd'].map((id) => ({ id, fp: `f${id}` })),
    stored
  )
  assert.deepEqual(
    reused.map((r) => r.pick.id),
    ['b', 'd']
  )
  assert.deepEqual(
    toWrite.map((p) => p.id),
    ['a', 'c']
  )
})
