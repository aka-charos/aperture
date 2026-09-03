import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {
  impersonationBlocksRequest,
  IMPERSONATION_DURATION_MINUTES,
  IMPERSONATION_READ_ONLY_ERROR,
} from './impersonation.js'

test('reading is always allowed — an assumed session is a browsing session', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get', 'head']) {
    assert.equal(impersonationBlocksRequest(method, '/api/recommendations'), false, method)
  }
})

test('the two GETs that write are refused, method notwithstanding', () => {
  // Found by tracing the call graph, not by reading handlers: GET
  // /api/trakt/auth-url mints a state token bound to request.user — the target
  // during an assumption — and GET /api/trakt/callback redeems it by writing
  // OAuth tokens to that account. Two GETs, one cross-account write that
  // outlives the assumption.
  assert.equal(impersonationBlocksRequest('GET', '/api/trakt/auth-url'), true)
  assert.equal(impersonationBlocksRequest('GET', '/api/trakt/callback?code=x&state=y'), true)

  // The rest of the Trakt surface is unaffected — this is an exception list,
  // not a prefix ban.
  assert.equal(impersonationBlocksRequest('GET', '/api/trakt/status'), false)
  assert.equal(impersonationBlocksRequest('GET', '/api/trakt/config'), false)
})

test('every write is refused, including the ones that look harmless', () => {
  // Each of these writes to the target account in a way the feature promises
  // not to: a preference, a rating, a conversation, a job on their behalf.
  const writes = [
    ['PATCH', '/api/auth/me/preferences'],
    ['POST', '/api/ratings'],
    ['POST', '/api/assistant/chat'],
    ['PUT', '/api/users/abc'],
    ['DELETE', '/api/auth/me/filter-presets/1'],
    ['POST', '/api/users/abc/sync-history'],
  ] as const

  for (const [method, url] of writes) {
    assert.equal(impersonationBlocksRequest(method, url), true, `${method} ${url}`)
  }
})

test('the two ways out are exempt, or the admin is trapped', () => {
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/impersonate/stop'), false)
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/logout'), false)
})

test('an exemption survives a query string and a trailing slash', () => {
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/impersonate/stop?to=/admin'), false)
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/impersonate/stop/'), false)
})

test('starting a second assumption is not exempt — assumptions cannot be chained', () => {
  // The start route deliberately sits one segment above the stop route, so the
  // exact-match allowlist refuses it while an assumption is active. That is
  // what keeps "the way back" a single account rather than a stack.
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/impersonate'), true)
})

test('a path that merely begins with an exempt one is still refused', () => {
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/logout/everyone'), true)
  assert.equal(impersonationBlocksRequest('POST', '/api/auth/impersonate/stopwatch'), true)
})

test('batch lookups that only look like writes are allowed through', () => {
  // Both are POSTs solely because a list of ids does not fit in a query
  // string. Refusing them would strip the favourite hearts and request badges
  // off every poster in the assumed session — the app rendering wrongly, in a
  // mode whose entire purpose is seeing it render as that user sees it.
  assert.equal(impersonationBlocksRequest('POST', '/api/favorites/status/bulk'), false)
  assert.equal(impersonationBlocksRequest('POST', '/api/seerr/status/batch'), false)

  // The neighbouring routes that DO write stay refused.
  assert.equal(impersonationBlocksRequest('POST', '/api/favorites'), true)
  assert.equal(impersonationBlocksRequest('POST', '/api/seerr/request'), true)
})

test('a refusal from an onRequest hook actually stops the handler', async () => {
  // The whole guarantee rests on one framework contract: an async onRequest
  // hook that replies must abort the lifecycle. If a Fastify upgrade ever
  // relaxes that, the guard silently becomes advisory and every write an
  // assumed session makes goes through — with a 403 on the wire and the row
  // already written. That failure is invisible in the response, so it is
  // pinned here rather than assumed.
  const app = Fastify()
  let handlerRan = false

  app.addHook('onRequest', async (request, reply) => {
    if (impersonationBlocksRequest(request.method, request.url)) {
      return reply.status(403).send(IMPERSONATION_READ_ONLY_ERROR)
    }
  })

  app.post('/api/ratings/movie/1', async () => {
    handlerRan = true
    return { ok: true }
  })
  app.get('/api/recommendations', async () => ({ ok: true }))

  const blocked = await app.inject({ method: 'POST', url: '/api/ratings/movie/1' })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().code, 'IMPERSONATION_READ_ONLY')
  assert.equal(handlerRan, false, 'the handler ran despite the refusal')

  const allowed = await app.inject({ method: 'GET', url: '/api/recommendations' })
  assert.equal(allowed.statusCode, 200)

  await app.close()
})

test('the lease is short enough that a missed exit control is a wait, not a ticket', () => {
  assert.ok(IMPERSONATION_DURATION_MINUTES > 0)
  assert.ok(IMPERSONATION_DURATION_MINUTES <= 8 * 60)
})
