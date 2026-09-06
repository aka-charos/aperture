import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { synopsisNeedsRefresh } from './tasteSynopsisRefresh.js'

const OLD = new Date('2026-01-01T00:00:00Z')
const NEW = new Date('2026-02-01T00:00:00Z')

describe('synopsisNeedsRefresh', () => {
  it('writes when there is no synopsis at all', () => {
    assert.equal(
      synopsisNeedsRefresh({ synopsis: null, synopsisUpdatedAt: null, profileUpdatedAt: NEW }),
      true
    )
  })

  it('treats an empty string as missing, agreeing with getTasteSynopsis', () => {
    // getTasteSynopsis reads '' as "never generated" and the card offers
    // Generate for it, so calling it current here would leave that button
    // permanently unanswered.
    for (const synopsis of ['', '   ', '\n']) {
      assert.equal(
        synopsisNeedsRefresh({ synopsis, synopsisUpdatedAt: OLD, profileUpdatedAt: OLD }),
        true,
        `expected ${JSON.stringify(synopsis)} to count as missing`
      )
    }
  })

  it('rewrites when the profile was rebuilt after the synopsis was written', () => {
    assert.equal(
      synopsisNeedsRefresh({
        synopsis: 'You gravitate toward slow, character-led drama.',
        synopsisUpdatedAt: OLD,
        profileUpdatedAt: NEW,
      }),
      true
    )
  })

  it('leaves an unchanged profile alone', () => {
    assert.equal(
      synopsisNeedsRefresh({
        synopsis: 'You gravitate toward slow, character-led drama.',
        synopsisUpdatedAt: NEW,
        profileUpdatedAt: OLD,
      }),
      false
    )
  })

  it('does not rewrite on an exact tie', () => {
    // The synopsis is written after the rebuild that prompted it, so equal
    // stamps mean "this text already describes that profile". Rewriting on a
    // tie would re-pay on every run for a profile nobody rebuilt.
    const same = new Date('2026-03-03T12:00:00Z')
    assert.equal(
      synopsisNeedsRefresh({ synopsis: 'text', synopsisUpdatedAt: same, profileUpdatedAt: same }),
      false
    )
  })

  it('does not treat a never-auto-built profile as stale', () => {
    // A locked profile has no auto_updated_at. There is nothing for the stored
    // text to be out of date with respect to, so this must not become a call
    // made on every run forever.
    assert.equal(
      synopsisNeedsRefresh({ synopsis: 'text', synopsisUpdatedAt: OLD, profileUpdatedAt: null }),
      false
    )
  })

  it('rewrites text that carries no stamp of its own', () => {
    // Cannot be shown to be current, and the asymmetry favours one call over an
    // identity that may describe a centroid that has since moved.
    assert.equal(
      synopsisNeedsRefresh({ synopsis: 'text', synopsisUpdatedAt: null, profileUpdatedAt: NEW }),
      true
    )
  })

  it('missing beats every other rule', () => {
    // Ordering matters: an absent synopsis with an unbuilt profile must still
    // be written, or a locked-profile user can never get one.
    assert.equal(
      synopsisNeedsRefresh({ synopsis: null, synopsisUpdatedAt: null, profileUpdatedAt: null }),
      true
    )
  })
})
