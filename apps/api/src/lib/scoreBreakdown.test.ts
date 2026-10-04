import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicScoreBreakdown, readTwinDonorId } from './scoreBreakdown.js'

const DONOR = '0b5c7e2a-1f3d-4c6b-9a8e-2d4f6a8c0e1b'

describe('readTwinDonorId', () => {
  it('reads the donor of a twin pick', () => {
    assert.equal(readTwinDonorId({ twinMatch: { donorId: DONOR, affinity: 2.1 } }), DONOR)
  })

  it('answers null for every other shape', () => {
    for (const value of [
      null,
      undefined,
      'twinMatch',
      {},
      { twinMatch: null },
      { twinMatch: 'x' },
      { twinMatch: {} },
      { twinMatch: { donorId: 42 } },
      { twinMatch: { donorId: '' } },
      { interestMatch: { donorId: DONOR } },
    ]) {
      assert.equal(readTwinDonorId(value), null, JSON.stringify(value))
    }
  })
})

describe('publicScoreBreakdown', () => {
  it('removes the donor id and keeps everything else', () => {
    const stored = {
      selectionScore: 0.7,
      twinMatch: { donorId: DONOR, affinity: 2.1, sharedCount: 9, sharedIds: ['a', 'b'] },
    }
    assert.deepEqual(publicScoreBreakdown(stored), {
      selectionScore: 0.7,
      twinMatch: { affinity: 2.1, sharedCount: 9, sharedIds: ['a', 'b'] },
    })
  })

  it('never mutates the stored row', () => {
    const stored = { twinMatch: { donorId: DONOR, affinity: 1 } }
    publicScoreBreakdown(stored)
    assert.equal(stored.twinMatch.donorId, DONOR)
  })

  it('keeps an emptied twin match, since its presence is what marks a twin pick', () => {
    const result = publicScoreBreakdown({ twinMatch: { donorId: DONOR } }) as Record<string, unknown>
    assert.deepEqual(result.twinMatch, {})
  })

  it('passes anything without a donor through as the same value', () => {
    const plain = { selectionScore: 0.5 }
    assert.equal(publicScoreBreakdown(plain), plain)
    const interest = { interestMatch: { interest: 'noir' } }
    assert.equal(publicScoreBreakdown(interest), interest)
    assert.equal(publicScoreBreakdown(null), null)
    assert.equal(publicScoreBreakdown(undefined), undefined)
  })
})

/**
 * Every route file that reads candidate rows' `score_breakdown` — named, or as
 * part of `rc.*` — must strip it before it leaves. Three routes sent it whole,
 * found by hand; this keeps a fourth from doing the same.
 */
describe('routes that read score_breakdown', () => {
  const routesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes')

  // A reader matches either spelling of the column leaving the database.
  const READS = /\brc\.\*|\brc\.score_breakdown\b/
  // Either the stripping helper, or the assistant's label derivation, which
  // sends a word and none of the column.
  const STRIPS = /\bpublicScoreBreakdown\b|\bpickSource\b/

  function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return routeFiles(path)
      return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
    })
  }

  const readers = routeFiles(routesDir).filter((file) => READS.test(readFileSync(file, 'utf8')))

  it('finds the known readers, so a broken pattern cannot pass by matching nothing', () => {
    const names = readers.map((file) => relative(routesDir, file).replace(/\\/g, '/'))
    for (const expected of [
      'recommendations/handlers/movies.ts',
      'recommendations/handlers/series.ts',
      'recommendations/handlers/history.ts',
      'assistant/tools/scoredPool.ts',
    ]) {
      assert.ok(names.includes(expected), `${expected} no longer matches the reader pattern`)
    }
  })

  for (const file of readers) {
    it(`${relative(routesDir, file).replace(/\\/g, '/')} strips the donor`, () => {
      assert.ok(
        STRIPS.test(readFileSync(file, 'utf8')),
        'reads score_breakdown but never calls publicScoreBreakdown — twinMatch.donorId would leave the server'
      )
    })
  }
})
