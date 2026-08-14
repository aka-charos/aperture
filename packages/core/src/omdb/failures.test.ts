import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OmdbRequestError,
  classifyOmdbFailure,
  isGlobalOmdbFailure,
  isNotFoundBody,
  isRetryableOmdbFailure,
} from './failures.js'

/**
 * The enrichment job stamps `omdb_enriched_at` when OMDb was asked and
 * answered, and an stamped row is excluded from every later pass. So the only
 * thing standing between a transient failure and a permanently retired row is
 * whether this module calls it an answer.
 *
 * The live failure these pin: a run where every request returned HTTP 401 and
 * every title was logged "OMDb: not found" and stamped complete.
 */

// ============================================================================
// 401 means two different things and only the body says which
// ============================================================================

test('an invalid key and a spent quota are told apart by the body, not the status', () => {
  assert.equal(classifyOmdbFailure(401, 'Invalid API key!'), 'auth')
  assert.equal(classifyOmdbFailure(401, 'Request limit reached!'), 'limit')
})

test('a bare 401 is reported as auth, the more actionable of the two guesses', () => {
  // Both stop the run, so nothing rides on this but which message is shown.
  assert.equal(classifyOmdbFailure(401, null), 'auth')
  assert.equal(classifyOmdbFailure(403, null), 'auth')
})

test('the body wins over the status, because OMDb sends these at 200 too', () => {
  // errors/handler.ts notes OMDb "often returns 200 with error in body" —
  // classifying on status alone would read an invalid key as a healthy reply.
  assert.equal(classifyOmdbFailure(200, 'Invalid API key!'), 'auth')
  assert.equal(classifyOmdbFailure(200, 'Request limit reached!'), 'limit')
})

test('a missing key is an auth failure, not a transport one', () => {
  assert.equal(classifyOmdbFailure(401, 'No API key provided.'), 'auth')
})

// ============================================================================
// What is worth retrying, and what is true of the whole run
// ============================================================================

test('server faults are transport failures and retry', () => {
  assert.equal(classifyOmdbFailure(500, null), 'transport')
  assert.equal(classifyOmdbFailure(503, null), 'transport')
  assert.ok(isRetryableOmdbFailure(classifyOmdbFailure(503, null)))
})

test('neither a bad key nor a spent quota is retried in the moment', () => {
  // A key does not become valid, and a daily quota does not refill, inside the
  // client's retry window — retrying only burns whatever quota is left.
  assert.equal(isRetryableOmdbFailure('auth'), false)
  assert.equal(isRetryableOmdbFailure('limit'), false)
})

test('auth and limit describe the key, so they predict every other request', () => {
  assert.ok(isGlobalOmdbFailure('auth'))
  assert.ok(isGlobalOmdbFailure('limit'))
  // A transport blip says nothing about the next title, so it must not latch.
  assert.equal(isGlobalOmdbFailure('transport'), false)
})

// ============================================================================
// What counts as an answer — the distinction that stamps a row
// ============================================================================

test('OMDb having no entry is an answer', () => {
  // These are permanent facts about the title. Retrying them every pass would
  // never end, which is what omdb_enriched_at exists to stop.
  assert.ok(isNotFoundBody('Movie not found!'))
  assert.ok(isNotFoundBody('Series not found!'))
  assert.ok(isNotFoundBody('Incorrect IMDb ID.'))
})

test('an auth failure dressed as Response:False is NOT an answer', () => {
  // The whole bug: treating every Response:"False" as not-found stamps a row
  // OMDb-complete on the strength of a reply saying the key is invalid.
  assert.equal(isNotFoundBody('Invalid API key!'), false)
  assert.equal(isNotFoundBody('Request limit reached!'), false)
})

test('an unrecognised error body is not an answer', () => {
  // Erring toward "failure" costs a retry next run; erring toward "answer"
  // costs the row its metadata permanently.
  assert.equal(isNotFoundBody('Error getting data.'), false)
  assert.equal(isNotFoundBody(undefined), false)
})

// ============================================================================
// The error carries its own classification
// ============================================================================

test('the error classifies itself from status and body', () => {
  const err = new OmdbRequestError(401, 'Invalid API key!')
  assert.equal(err.kind, 'auth')
  assert.equal(err.status, 401)
  assert.equal(err.omdbError, 'Invalid API key!')
  assert.match(err.message, /Invalid API key!/)
})

test('an explicit kind overrides the classifier, for the latched case', () => {
  // A latched failure has no live response to classify — status 0 would read
  // as transport and retry the very thing the latch exists to stop.
  const err = new OmdbRequestError(0, 'Invalid API key!', 'auth')
  assert.equal(err.kind, 'auth')
})

test('a bodyless failure still produces a usable message', () => {
  const err = new OmdbRequestError(502, null)
  assert.equal(err.kind, 'transport')
  assert.match(err.message, /HTTP 502/)
})
