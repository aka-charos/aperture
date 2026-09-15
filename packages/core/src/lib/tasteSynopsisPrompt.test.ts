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
    // reads a stored NULL as older than this.
    assert.ok(Number.isInteger(TASTE_SYNOPSIS_PROMPT_VERSION))
    assert.ok(TASTE_SYNOPSIS_PROMPT_VERSION >= 2)
  })

  it('states the rules that keep it from writing a horoscope, for both media types', () => {
    for (const mediaType of MEDIA_TYPES) {
      const prompt = buildTasteSynopsisSystemPrompt(mediaType)
      for (const marker of [
        'more or less often than the library offers it',
        'not who they are',
        'how often they rewatch',
        'No invented labels or trait names',
        'Do not bring in titles that are not in it',
        'Under 180 words',
      ]) {
        assert.ok(prompt.includes(marker), `${mediaType}: missing "${marker}"`)
      }
    }
  })

  it('names the kind of person that recurs for each media type', () => {
    assert.ok(buildTasteSynopsisSystemPrompt('movie').includes('a director'))
    assert.ok(!buildTasteSynopsisSystemPrompt('movie').includes('network'))
    assert.ok(buildTasteSynopsisSystemPrompt('series').includes('a network'))
    assert.ok(!buildTasteSynopsisSystemPrompt('series').includes('director'))
  })

  it('keeps real names out of the examples the model is asked to imitate', () => {
    // A model imitating "You pick Japanese films... Kurosawa and Ozu..." puts
    // Kurosawa into identities for people who have never watched him. Outside
    // the [placeholders], the only capitalised words allowed are the sentence
    // opener and IMDb.
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
          assert.ok(['You', 'IMDb'].includes(word), `${mediaType}: "${word}" in "${example}"`)
        }
      }
    }
  })
})
