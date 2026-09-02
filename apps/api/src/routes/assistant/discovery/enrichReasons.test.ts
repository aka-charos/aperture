/**
 * The card-note reader, pinned against what a reasoning model actually returns.
 *
 * Every "scratchpad" string below was printed on a real card, under a lightbulb
 * icon, in a shipped build. The parser could not tell them from answers because
 * they arrive in the answer's shape: numbered, one line per title, fluent.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPresentableReason, parseReasonLines } from './enrichReasons.js'

describe('isPresentableReason', () => {
  it('accepts a note written for the reader', () => {
    assert.equal(
      isPresentableReason(
        "Herzog remade Murnau shot for shot, with Kinski's Count a deliberate echo of Schreck's silhouette."
      ),
      true
    )
  })

  it('accepts second person — that is the reader being addressed, not the model', () => {
    assert.equal(
      isPresentableReason(
        "You'll recognise the silhouette immediately; the whole film is built around that one shape."
      ),
      true
    )
  })

  it('rejects the model narrating its own task', () => {
    for (const scratchpad of [
      "Herzog's remake directly homage, Kinski as Orlok-like Dracula. I need to mention the direct homage.",
      'Fictionalized making-of, Dafoe as Schreck. Need to mention the meta-fictional approach here.',
      'Let me think about what this film shares with the request before writing the note.',
      'No research note provided, only synopsis. This seems like a British fantasy film.',
      "The synopsis doesn't suggest it, but the user included it in the list anyway.",
      "I'm not aware of direct Nosferatu inspiration. It's about the birth of the Antichrist.",
    ]) {
      assert.equal(isPresentableReason(scratchpad), false, scratchpad)
    }
  })

  it('rejects a note that ran out of budget mid-thought', () => {
    assert.equal(
      isPresentableReason('A gothic study in shadow and dread, the kind of film that…'),
      false
    )
  })

  it('rejects a fragment too short to be a sentence', () => {
    assert.equal(isPresentableReason('Gothic horror.'), false)
  })
})

describe('parseReasonLines', () => {
  it('keeps the answers and drops the scratchpad in one response', () => {
    const parsed = parseReasonLines(
      [
        '1 | Herzog remade Murnau shot for shot, with Kinski a deliberate echo of Schreck.',
        '2 | No research note provided, only synopsis. I need to check whether it fits.',
        '3 | Petyr is drawn as Orlok outright, which turns the whole joke into a tribute.',
      ].join('\n')
    )
    assert.deepEqual([...parsed.keys()], [1, 3])
  })

  it('returns nothing rather than a plan when the whole response is one', () => {
    const parsed = parseReasonLines(
      ['1 | I need to mention the direct homage and the visual replication.'].join('\n')
    )
    assert.equal(parsed.size, 0)
  })
})
