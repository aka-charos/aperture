import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CRW_CONFIG,
  CRW_DEFAULT_PAGE_TIMEOUT_MS,
  CRW_PAGE_TIMEOUT_MAX_MS,
  CRW_PAGE_TIMEOUT_MIN_MS,
  SEARCH_LEG_ALLOWANCE_MS,
  describeTestOutcome,
  effectivePageTimeoutMs,
  minimumRequestTimeoutMs,
  readCrwWarnings,
} from './crw.js'

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
// The two timeouts
// ============================================================================

test('the default request timeout leaves the default page budget its full length', () => {
  // Inside /v1/search CRW gives each result page its own deadline, so a search
  // call is bounded by its search leg plus ONE page budget. The request timeout
  // has to clear both, or Aperture abandons a call CRW was about to answer -
  // and a timeout here throws, writing no row, so the title's work is lost.
  assert.ok(
    DEFAULT_CRW_CONFIG.timeoutMs >= minimumRequestTimeoutMs(DEFAULT_CRW_CONFIG.pageTimeoutMs),
    `default timeout ${DEFAULT_CRW_CONFIG.timeoutMs}ms is below what a ${DEFAULT_CRW_CONFIG.pageTimeoutMs}ms page budget needs`
  )
  assert.equal(
    effectivePageTimeoutMs(DEFAULT_CRW_CONFIG.pageTimeoutMs, DEFAULT_CRW_CONFIG.timeoutMs),
    DEFAULT_CRW_CONFIG.pageTimeoutMs
  )
})

test('the largest page budget fits under a request timeout the route allows', () => {
  // The route caps timeoutMs at 300s; the largest page budget must be
  // configurable with it, or the top of the range is unreachable.
  assert.ok(minimumRequestTimeoutMs(CRW_PAGE_TIMEOUT_MAX_MS) <= 300_000)
})

test('the page budget sent never exceeds what CRW accepts', () => {
  // CRW answers 400 above 60s, which would fail EVERY search, not just slow ones.
  assert.equal(CRW_PAGE_TIMEOUT_MAX_MS, 60_000)
  assert.equal(effectivePageTimeoutMs(120_000, 300_000), CRW_PAGE_TIMEOUT_MAX_MS)
})

test('a stored request timeout too short for the page budget shrinks the budget', () => {
  // A pair saved before the route checked it: the budget gives way, because a
  // page budget Aperture cannot wait for loses the whole call.
  const sent = effectivePageTimeoutMs(45_000, 90_000)
  assert.ok(sent < 45_000)
  assert.ok(sent + SEARCH_LEG_ALLOWANCE_MS <= 90_000)
})

test('the shrink never goes below the 15s CRW uses when no budget is sent', () => {
  // So an old deployment with a short request timeout behaves exactly as it did
  // before the setting existed, never worse.
  assert.equal(effectivePageTimeoutMs(45_000, 30_000), CRW_DEFAULT_PAGE_TIMEOUT_MS)
})

test('a budget configured below 15s is sent as configured, not raised', () => {
  // The floor limits the shrink; it must not overrule an operator who chose
  // faster searches over slow pages.
  assert.equal(effectivePageTimeoutMs(CRW_PAGE_TIMEOUT_MIN_MS, 300_000), CRW_PAGE_TIMEOUT_MIN_MS)
  assert.ok(CRW_PAGE_TIMEOUT_MIN_MS < CRW_DEFAULT_PAGE_TIMEOUT_MS)
})
