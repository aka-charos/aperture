import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_CRW_CONFIG, describeTestOutcome, readCrwWarnings } from './crw.js'

// ============================================================================
// Reading soft failures out of a 200
// ============================================================================

test('warnings are read from the documented envelope', () => {
  // `ApiResponse::ok(SearchResponseData { results, warnings })` — the plural
  // list sits inside `data`, one level down from where a flat reader looks.
  assert.deepEqual(
    readCrwWarnings({
      success: true,
      data: { results: [], warnings: ["search engine 'google' returned nothing"] },
    }),
    ["search engine 'google' returned nothing"]
  )
})

test('the singular top-level warning is read too, and merged with the list', () => {
  // Two different failures with two different shapes: engine-level problems are
  // a list inside the payload, a partial scrape failure is a scalar beside it.
  // An operator needs both, and neither implies the other.
  assert.deepEqual(
    readCrwWarnings({
      warning: 'scrape enrichment failed',
      data: { warnings: ["search engine 'bing' unavailable"] },
    }),
    ['scrape enrichment failed', "search engine 'bing' unavailable"]
  )
})

test('a duplicate notice is reported once', () => {
  assert.deepEqual(
    readCrwWarnings({ warning: 'engine blocked', data: { warnings: ['engine blocked'] } }),
    ['engine blocked']
  )
})

test('a clean response has no warnings, and malformed ones do not throw', () => {
  assert.deepEqual(readCrwWarnings({ success: true, data: { results: [{ url: 'x' }] } }), [])
  // Every one of these has been a real shape from something at some point; the
  // reader is liberal on purpose, and a diagnostic must never be the thing that
  // takes the request down.
  assert.deepEqual(readCrwWarnings(null), [])
  assert.deepEqual(readCrwWarnings('nope'), [])
  assert.deepEqual(readCrwWarnings({ data: { warnings: 'not an array' } }), ['not an array'])
  assert.deepEqual(readCrwWarnings({ data: { warnings: [null, 42, '  ', 'real'] } }), ['real'])
})

// ============================================================================
// What the Test button concludes
// ============================================================================

test('an empty result set FAILS the connection test', () => {
  // The regression this exists for. Measured live: a first-boot browser profile
  // on a datacenter address was handed Google's /sorry/index interstitial, and
  // the call returned 200 with `{results: []}`. The old probe reported
  // "Connected. Search returned 0 result(s)." and rendered a green tick over a
  // retrieval service that could not retrieve.
  const outcome = describeTestOutcome({ resultCount: 0, warnings: [] })
  assert.equal(outcome.success, false)
  assert.match(outcome.message, /no results/i)
  // The probe query is banal by design, so "no results" cannot mean "hard
  // question" — the message has to point at the backend or it teaches nothing.
  assert.match(outcome.message, /search backend/i)
})

test('a failing test repeats whatever reason the service gave', () => {
  const outcome = describeTestOutcome({
    resultCount: 0,
    warnings: ["search engine 'google' returned nothing"],
  })
  assert.equal(outcome.success, false)
  assert.match(outcome.message, /search engine 'google' returned nothing/)
})

test('a failing test says outright when there was no reason to give', () => {
  // Silence is itself information: it separates "the engine told us it was
  // blocked" from "everything claimed success and produced nothing", which have
  // different next steps.
  const outcome = describeTestOutcome({ resultCount: 0, warnings: [] })
  assert.match(outcome.message, /reported no reason/i)
})

test('results pass, and carry any warnings with them', () => {
  const clean = describeTestOutcome({ resultCount: 1, warnings: [] })
  assert.equal(clean.success, true)
  assert.match(clean.message, /returned 1 result/)

  // A degraded engine still passes — one working engine is a working search —
  // but it is worth knowing before a library-wide batch rather than after.
  const degraded = describeTestOutcome({
    resultCount: 3,
    warnings: ["search engine 'bing' unavailable"],
  })
  assert.equal(degraded.success, true)
  assert.match(degraded.message, /bing/)
})

// ============================================================================
// The timeout default
// ============================================================================

test('the default timeout clears the service’s own worst-case page deadline', () => {
  // Not taste: CRW prints its arithmetic at boot, and a stock deployment logs
  //   deadline_ms_default=15000 ladder_min_ms=82500 effective_default_ms=82500
  // because auto_extend_deadline_for_ladder lets one page that reaches the heavy
  // browser tier have the whole ladder. Search runs before any of that, so the
  // ceiling has to clear 82.5s with the search leg on top. The previous 90s
  // default did not — and a timeout here throws, writing no row, so the title
  // silently stays pending and the work is lost rather than retried loudly.
  const observedLadderMs = 82_500
  assert.ok(
    DEFAULT_CRW_CONFIG.timeoutMs > observedLadderMs * 1.5,
    `default timeout ${DEFAULT_CRW_CONFIG.timeoutMs}ms leaves too little room over a ${observedLadderMs}ms page deadline`
  )
})
