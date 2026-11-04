import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StoredAnalysis } from '@aperture/core'
import { analysisProvenance } from './provenance.js'

const stored: StoredAnalysis = {
  mediaType: 'movie',
  mediaId: 'id',
  analysis: 'prose',
  declineReason: null,
  sources: [],
  sourceGrade: null,
  sourceCount: 3,
  retrievedChars: 900,
  model: 'some/model',
  retrievalMode: 'crw',
  paragraphMap: null,
  promptVersion: 18,
  promptVariant: null,
  retrievalMs: 62_000,
  writeMs: 130_000,
  analyzedAt: '2026-11-05T10:00:00.000Z',
}

test('both timing figures reach the panel', () => {
  const sent = analysisProvenance(stored)
  assert.equal(sent.retrievalMs, 62_000)
  assert.equal(sent.writeMs, 130_000)
})

test('an unmeasured time stays null, and a zero stays a zero', () => {
  const sent = analysisProvenance({ ...stored, retrievalMs: null, writeMs: 0 })
  assert.equal(sent.retrievalMs, null)
  assert.equal(sent.writeMs, 0)
})
