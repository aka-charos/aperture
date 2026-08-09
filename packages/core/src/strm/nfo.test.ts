import test from 'node:test'
import assert from 'node:assert/strict'
import { generateNfoContent } from './movies/nfo.js'
import { generateSeriesNfoContent } from './series/nfo.js'
import type { Movie } from './types.js'
import type { Series } from './series/types.js'

/**
 * The plot is the one piece of NFO the viewer actually reads, and it carries
 * the instance's name. These pin that the name is the configured one, that the
 * explanation is genuinely suppressed rather than merely unlabelled when the
 * setting is off, and that the two media types agree.
 */

const movie = {
  title: 'A Film',
  overview: 'What the film is about.',
  aiExplanation: 'Because you liked three like it.',
} as unknown as Movie

const series = {
  title: 'A Show',
  overview: 'What the show is about.',
  aiExplanation: 'Because you liked three like it.',
} as unknown as Series

/** First line of the plot, which is where the credit line lives. */
function plotOf(nfo: string): string {
  const match = nfo.match(/<plot>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/plot>/)
  assert.ok(match, 'expected the NFO to contain a plot')
  return match[1]
}

// ============================================================================
// The credit line follows the instance's name
// ============================================================================

test('the plot credits the configured instance name, not the shipped brand', () => {
  const nfo = generateNfoContent(movie, {
    includeImageUrls: false,
    includeAiExplanation: true,
    appName: 'Rec Room',
  })

  assert.match(plotOf(nfo), /Why Rec Room picked this for you/)
  assert.doesNotMatch(plotOf(nfo), /Aperture/)
})

test('series NFO credits the same way movies do', () => {
  const nfo = generateSeriesNfoContent(series, {
    includeImageUrls: false,
    includeAiExplanation: true,
    appName: 'Rec Room',
  })

  assert.match(plotOf(nfo), /Why Rec Room picked this for you/)
  assert.doesNotMatch(plotOf(nfo), /Aperture/)
})

test('an omitted name falls back to the shipped brand rather than a blank credit', () => {
  const nfo = generateNfoContent(movie, {
    includeImageUrls: false,
    includeAiExplanation: true,
  })

  assert.match(plotOf(nfo), /Why Aperture picked this for you/)
})

test('the legacy boolean signature still produces a complete credit line', () => {
  // Older call sites pass (movie, includeImageUrls, dateAdded).
  const nfo = generateNfoContent(movie, true)

  assert.match(plotOf(nfo), /Why Aperture picked this for you/)
})

// ============================================================================
// Switching explanations off removes the text, not just the heading
// ============================================================================

test('a disabled explanation leaves the plot as the plain overview', () => {
  const nfo = generateNfoContent(movie, {
    includeImageUrls: false,
    includeAiExplanation: false,
    appName: 'Rec Room',
  })

  assert.equal(plotOf(nfo), 'What the film is about.')
  assert.doesNotMatch(plotOf(nfo), /Because you liked/)
})

test('a candidate with no generated explanation reads as a normal item', () => {
  // What every run produces once generation is gated off.
  const unexplained = { ...movie, aiExplanation: null } as unknown as Movie
  const nfo = generateNfoContent(unexplained, {
    includeImageUrls: false,
    includeAiExplanation: true,
    appName: 'Rec Room',
  })

  assert.equal(plotOf(nfo), 'What the film is about.')
})

test('the original overview survives underneath the explanation', () => {
  const nfo = generateNfoContent(movie, {
    includeImageUrls: false,
    includeAiExplanation: true,
    appName: 'Rec Room',
  })

  const plot = plotOf(nfo)
  assert.match(plot, /Because you liked three like it\./)
  assert.match(plot, /What the film is about\./)
  assert.ok(
    plot.indexOf('Because you liked') < plot.indexOf('What the film is about'),
    'the explanation leads, the overview follows'
  )
})
