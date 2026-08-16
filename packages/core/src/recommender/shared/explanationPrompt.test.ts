/**
 * The prompt budget helper.
 *
 * `clip` is small, but it is the thing standing between a synopsis and a model
 * that has been told not to invent: a summary that *looks* cut off is an
 * invitation to continue it, which is exactly what the surrounding change is
 * trying to stop.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { clip, PICK_PLOT_CHARS, EVIDENCE_PLOT_CHARS } from './explanationPrompt.js'

describe('clip', () => {
  test('leaves a short text exactly as written', () => {
    // No ellipsis, because nothing was removed. The generators previously
    // appended '...' unconditionally, so a complete two-sentence synopsis was
    // handed over looking as though it trailed off.
    const text = 'A fixer for a Seoul crime family discovers his employer is his father.'
    assert.equal(clip(text, 200), text)
  })

  test('trims whitespace rather than counting it toward the budget', () => {
    assert.equal(clip('   spaced out   ', 50), 'spaced out')
  })

  test('an empty or missing overview is null, not an empty string', () => {
    // The callers branch on null to omit the line entirely; '' would render as
    // a dangling colon.
    assert.equal(clip(null, 100), null)
    assert.equal(clip(undefined, 100), null)
    assert.equal(clip('', 100), null)
    assert.equal(clip('   ', 100), null)
  })

  test('cuts on a word boundary and marks the cut', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve'
    const result = clip(text, 20)!

    assert.ok(result.endsWith('…'))
    assert.ok(result.length <= 21)
    // The last kept token is whole.
    assert.ok(text.startsWith(result.slice(0, -1)))
    assert.ok(!result.slice(0, -1).endsWith(' '))
  })

  test('does not strand most of the budget when there is no nearby space', () => {
    // A long unbroken token — a URL, a run-on caption — must not collapse the
    // output to a couple of characters just because the only space is early.
    const text = `a ${'x'.repeat(200)}`
    const result = clip(text, 50)!

    assert.ok(result.length >= 45, `expected a full-ish clip, got ${result.length}`)
  })

  test('no trailing punctuation is left hanging before the ellipsis', () => {
    const result = clip('Berlin, 1929, and the vice squad, overwhelmed, gives up entirely', 15)!

    assert.ok(!/[\s,;:]…$/.test(result), result)
  })

  test('the two budgets stay ordered, and a pick outweighs its evidence', () => {
    // Three evidence synopses ride along with every pick. At parity the films
    // being explained would be outweighed by the films they are compared to.
    assert.ok(EVIDENCE_PLOT_CHARS < PICK_PLOT_CHARS)
    assert.ok(EVIDENCE_PLOT_CHARS * 3 <= PICK_PLOT_CHARS * 1.2)
  })
})
