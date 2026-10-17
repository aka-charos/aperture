import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groundingSearchCount } from './groundingSearches.js'

describe('groundingSearchCount', () => {
  it('counts the searches Gemini reported', () => {
    const metadata = {
      google: { groundingMetadata: { webSearchQueries: ['greek new wave films', 'Θόδωρος Αγγελόπουλος ταινίες'] } },
    }
    assert.equal(groundingSearchCount(metadata), 2)
  })

  it('reads a response with no grounding metadata as no searches', () => {
    // Gemini answered without searching: a real zero, not an unknown.
    assert.equal(groundingSearchCount({ google: {} }), 0)
    assert.equal(groundingSearchCount({}), 0)
    assert.equal(groundingSearchCount(undefined), 0)
    assert.equal(groundingSearchCount(null), 0)
  })

  it('ignores a malformed field instead of throwing', () => {
    assert.equal(groundingSearchCount({ google: { groundingMetadata: { webSearchQueries: 'one' } } }), 0)
    assert.equal(groundingSearchCount({ google: null }), 0)
  })
})
