/**
 * Country filter normalization.
 *
 * The bug this pins: `production_countries` stores "France", the user says
 * "French film noir", and `'{France}' ILIKE '%French%'` is false — so the
 * filter silently excluded every one of the 1,688 French films in the library
 * and the chat answered "you haven't watched any".
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCountryQuery } from './countryMatch.js'

/** Mirrors the SQL: production_countries::text ILIKE '%value%'. */
function wouldMatch(stored: string[], filter: string): boolean {
  const asText = `{${stored.join(',')}}`
  return asText.toLowerCase().includes(normalizeCountryQuery(filter).toLowerCase())
}

describe('normalizeCountryQuery', () => {
  test('maps the nationality to the stored country name', () => {
    assert.equal(normalizeCountryQuery('French'), 'France')
    assert.equal(normalizeCountryQuery('Japanese'), 'Japan')
    assert.equal(normalizeCountryQuery('Korean'), 'South Korea')
    assert.equal(normalizeCountryQuery('Italian'), 'Italy')
  })

  test('leaves a country name alone', () => {
    // The prompt asks for "France"; the model often complies. Both must work.
    assert.equal(normalizeCountryQuery('France'), 'France')
    assert.equal(normalizeCountryQuery('South Korea'), 'South Korea')
  })

  test('is case- and whitespace-insensitive', () => {
    assert.equal(normalizeCountryQuery('  fRENch '), 'France')
    assert.equal(normalizeCountryQuery('south  korean'), 'South Korea')
  })

  test('passes unknown input through rather than dropping it', () => {
    // Degrades to today's behaviour instead of erroring or matching nothing.
    assert.equal(normalizeCountryQuery('Wakandan'), 'Wakandan')
    assert.equal(normalizeCountryQuery(''), '')
  })

  test('resolves to a substring that covers stored variants', () => {
    // One entry has to cover several spellings, because the value is used in a
    // LIKE and TMDB is not consistent about long-form names.
    assert.ok(wouldMatch(['United States of America'], 'American'))
    assert.ok(wouldMatch(['United States'], 'American'))
    assert.ok(wouldMatch(['West Germany'], 'German'))
    assert.ok(wouldMatch(['Czech Republic'], 'Czech'))
    assert.ok(wouldMatch(['Czechoslovakia'], 'Czech'))
  })
})

describe('the filter this feeds', () => {
  test('the reported failure now matches', () => {
    // "list me the french film noir movies I watched" — Le Samouraï is stored
    // as {France,Italy} and was invisible to `%French%`.
    assert.equal(wouldMatch(['France', 'Italy'], 'French'), true)
  })

  test('still excludes films from elsewhere', () => {
    // Stray Dog and The Wall are what the unfiltered semantic search returned.
    assert.equal(wouldMatch(['Japan'], 'French'), false)
    assert.equal(wouldMatch(['Turkey', 'France'], 'Japanese'), false)
  })

  test('a co-production counts for either country', () => {
    assert.equal(wouldMatch(['France', 'Italy'], 'Italian'), true)
  })
})

describe('the canonical pass', () => {
  test('a filter written in another vocabulary still resolves', () => {
    // The value arrives from a language model, which will write any of these.
    // Before the canonical pass, only the last one found anything.
    assert.equal(normalizeCountryQuery('USA'), 'United States')
    assert.equal(normalizeCountryQuery('UK'), 'United Kingdom')
    assert.equal(normalizeCountryQuery('Ελλάδα'), 'Greece')
    assert.equal(normalizeCountryQuery('Türkiye'), 'Turkey')
    assert.equal(normalizeCountryQuery('Czechia'), 'Czech Republic')
  })

  test('deliberately partial entries survive it', () => {
    // "Czech" is not a country, so the canonical pass leaves it — which is
    // what lets one filter cover three stored spellings.
    assert.equal(normalizeCountryQuery('Czech'), 'Czech')
    assert.ok(wouldMatch(['Czech Republic'], 'Czech'))
    assert.ok(wouldMatch(['Czechoslovakia'], 'Czech'))
  })

  test('an unknown filter is still passed through', () => {
    assert.equal(normalizeCountryQuery('Wakanda'), 'Wakanda')
  })
})

describe('the two German states', () => {
  test('East German films are findable at all', () => {
    // This resolved to "German Democratic Republic", which appears nowhere in
    // the column — the library stores "East Germany" — so the filter matched
    // nothing whatsoever.
    assert.equal(normalizeCountryQuery('East German'), 'East Germany')
    assert.ok(wouldMatch(['East Germany'], 'East German'))
  })

  test('West German means West German, not German', () => {
    // This resolved to "Germany", and '%Germany%' matches every German film
    // there is — the answer to "west german cinema" was the whole shelf.
    assert.equal(normalizeCountryQuery('West German'), 'West Germany')
    assert.ok(wouldMatch(['West Germany'], 'West German'))
    assert.equal(wouldMatch(['Germany'], 'West German'), false)
  })

  test('plain German still covers both, which is the point of a substring', () => {
    assert.ok(wouldMatch(['Germany'], 'German'))
    assert.ok(wouldMatch(['West Germany'], 'German'))
    assert.ok(wouldMatch(['East Germany'], 'German'))
  })
})

describe('countries that only exist after normalisation', () => {
  test('Palestinian films are findable now the spellings are merged', () => {
    assert.equal(normalizeCountryQuery('Palestinian'), 'Palestine')
    assert.ok(wouldMatch(['Palestine'], 'Palestinian'))
  })

  test('Soviet films are not Russian films', () => {
    assert.equal(normalizeCountryQuery('Soviet'), 'Soviet Union')
    assert.ok(wouldMatch(['Soviet Union'], 'Soviet'))
    assert.equal(wouldMatch(['Russia'], 'Soviet'), false)
  })
})
