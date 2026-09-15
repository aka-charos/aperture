import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TASTE_SYNOPSIS_PROMPT_VERSION,
  buildTasteSynopsisSystemPrompt,
} from './tasteSynopsisPrompt.js'

const MEDIA_TYPES = ['movie', 'series'] as const

describe('buildTasteSynopsisSystemPrompt', () => {
  it('carries a version the refresh gate can compare', () => {
    // Version 1 is every identity written before versions were stored; the gate
    // reads a stored NULL as older than this. Version 2 was the recited one.
    assert.ok(Number.isInteger(TASTE_SYNOPSIS_PROMPT_VERSION))
    assert.ok(TASTE_SYNOPSIS_PROMPT_VERSION >= 3)
  })

  it('asks for analysis and states the rules against both earlier failures, for both media types', () => {
    for (const mediaType of MEDIA_TYPES) {
      const prompt = buildTasteSynopsisSystemPrompt(mediaType)
      for (const marker of [
        // Version 2's recital.
        "Interpret the evidence, don't recite it",
        'never write ratios or pairs of percentages',
        'Say what the titles have in common',
        // Version 1's horoscope.
        'false for most viewers',
        'not their personality',
        'how often they rewatch',
        'No invented labels or trait names',
        // Both.
        'Name only titles that appear in the evidence',
        'one franchise',
        '200 to 300 words',
      ]) {
        assert.ok(prompt.includes(marker), `${mediaType}: missing "${marker}"`)
      }
    }
  })

  it('asks about how a show is watched for TV only', () => {
    assert.ok(buildTasteSynopsisSystemPrompt('series').includes('### How you watch'))
    assert.ok(!buildTasteSynopsisSystemPrompt('movie').includes('### How you watch'))
  })

  it('names the kind of person that recurs for each media type', () => {
    assert.ok(buildTasteSynopsisSystemPrompt('movie').includes('kind of director'))
    assert.ok(!buildTasteSynopsisSystemPrompt('movie').includes('network'))
    assert.ok(buildTasteSynopsisSystemPrompt('series').includes('kind of network'))
    assert.ok(!buildTasteSynopsisSystemPrompt('series').includes('director'))
  })

  it('keeps real names out of the examples the model is asked to imitate', () => {
    // A model imitating "Your comedies... Withnail & I..." puts that film into
    // identities for people who have never watched it. Outside the
    // [placeholders], the only capitalised words allowed are sentence openers.
    for (const mediaType of MEDIA_TYPES) {
      const right = buildTasteSynopsisSystemPrompt(mediaType)
        .split('\n')
        .find((line) => line.startsWith('Right:'))
      assert.ok(right, `${mediaType}: no Right: examples`)

      const examples = [...right.matchAll(/"([^"]+)"/g)].map((m) => m[1])
      assert.ok(examples.length >= 2)
      for (const example of examples) {
        const capitalised = example.replace(/\[[^\]]+\]/g, '').match(/\b[A-Z][A-Za-z]*/g) ?? []
        for (const word of capitalised) {
          assert.ok(['You', 'Your', 'IMDb'].includes(word), `${mediaType}: "${word}" in "${example}"`)
        }
      }
    }
  })
})
