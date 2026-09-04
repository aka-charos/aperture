import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredBlendShares, realisedBlendShares } from './blendDiagnostics.js'
import { DEFAULT_DISCOVERY_CONFIG } from './types.js'
import type { DiscoveryConfig } from './types.js'

function config(partial: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return { ...DEFAULT_DISCOVERY_CONFIG, ...partial }
}

const sum = (s: { similarity: number; popularity: number; recency: number; source: number }) =>
  s.similarity + s.popularity + s.recency + s.source

test('the configured shares include the source term the card used to hide', () => {
  // The panel divided by the three slider weights alone and reported 50/30/20.
  // scoreCandidates divides by 1.1, because the fixed source term is a real
  // claimant on the same budget.
  const shares = configuredBlendShares(config())

  assert.ok(Math.abs(shares.similarity - 45.4545) < 0.001)
  assert.ok(Math.abs(shares.popularity - 27.2727) < 0.001)
  assert.ok(Math.abs(shares.recency - 18.1818) < 0.001)
  assert.ok(Math.abs(shares.source - 9.0909) < 0.001)
})

test('configured shares always total 100', () => {
  for (const c of [
    config(),
    config({ similarityWeight: 1, popularityWeight: 0, recencyWeight: 0 }),
    config({ similarityWeight: 0.2, popularityWeight: 0.2, recencyWeight: 0.6 }),
  ]) {
    assert.ok(Math.abs(sum(configuredBlendShares(c)) - 100) < 1e-9)
  }
})

test('all three sliders at zero hands the whole score to the source term', () => {
  // Not an even split, which is what this test first asserted and what the
  // config sanitiser's comment implies. The discovery scorer's guard is
  // `totalWeight <= 0`, and totalWeight INCLUDES the fixed source term -- so
  // with the three sliders at zero the total is 0.1, the guard never fires, and
  // baseScore reduces to the source score alone.
  //
  // Unreachable through the UI (sanitizeDiscoveryConfig restores the defaults
  // when all three are zero), and worth pinning anyway: this function's whole
  // job is to report what the scorer does rather than what it ought to.
  const shares = configuredBlendShares(
    config({ similarityWeight: 0, popularityWeight: 0, recencyWeight: 0 })
  )
  assert.deepEqual(shares, { similarity: 0, popularity: 0, recency: 0, source: 100 })
})

test('the realised shares reproduce the live measurement', () => {
  // Measured on one instance, movie side: similarity 0.210, popularity 0.151,
  // recency 0.348, source 0.194. Recency over-delivers against a configured
  // 18.2 and popularity under-delivers against 27.3, which is the whole reason
  // this module exists.
  const shares = realisedBlendShares(
    { similarity: 0.21, popularity: 0.151, recency: 0.348, source: 0.194 },
    config()
  )

  assert.ok(shares !== null)
  assert.ok(Math.abs(shares!.similarity - 43.9) < 0.2, `similarity ${shares!.similarity}`)
  assert.ok(Math.abs(shares!.popularity - 18.9) < 0.2, `popularity ${shares!.popularity}`)
  assert.ok(Math.abs(shares!.recency - 29.1) < 0.2, `recency ${shares!.recency}`)

  // The direction is the claim: recency does MORE than it says, popularity
  // less. A sign flip here means the argument has been inverted.
  const configured = configuredBlendShares(config())
  assert.ok(shares!.recency > configured.recency)
  assert.ok(shares!.popularity < configured.popularity)
})

test('equal spreads make realised match configured exactly', () => {
  // The control. If every term used the same range there would be nothing to
  // report, and any difference here would be an arithmetic error rather than a
  // finding.
  const c = config()
  const shares = realisedBlendShares(
    { similarity: 0.3, popularity: 0.3, recency: 0.3, source: 0.3 },
    c
  )
  const configured = configuredBlendShares(c)

  assert.ok(shares !== null)
  for (const term of ['similarity', 'popularity', 'recency', 'source'] as const) {
    assert.ok(
      Math.abs(shares![term] - configured[term]) < 1e-9,
      `${term}: ${shares![term]} vs ${configured[term]}`
    )
  }
})

test('realised shares always total 100', () => {
  const shares = realisedBlendShares(
    { similarity: 0.21, popularity: 0.151, recency: 0.348, source: 0.194 },
    config()
  )
  assert.ok(shares !== null)
  assert.ok(Math.abs(sum(shares!) - 100) < 1e-9)
})

test('a term with no spread realises nothing, however it is weighted', () => {
  // A flat term contributes no ranking variation whatever its slider says --
  // which is the constant-0.5 state the taste term was in for the whole life of
  // the feature, and the thing this panel exists to make visible.
  const shares = realisedBlendShares(
    { similarity: 0, popularity: 0.2, recency: 0.2, source: 0.2 },
    config()
  )
  assert.ok(shares !== null)
  assert.equal(shares!.similarity, 0)
})

test('nothing measurable returns null rather than a confident even split', () => {
  assert.equal(
    realisedBlendShares({ similarity: 0, popularity: 0, recency: 0, source: 0 }, config()),
    null
  )
})

test('a non-finite spread returns null rather than propagating NaN into a percentage', () => {
  assert.equal(
    realisedBlendShares(
      { similarity: NaN, popularity: 0.2, recency: 0.2, source: 0.2 },
      config()
    ),
    null
  )
})
