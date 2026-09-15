/**
 * The walls are the exact text two bench runs retrieved as sources. The
 * negatives matter as much: a real page must never be dropped for its subject.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BLOCKED_PAGE_MAX_CHARS, isBlockedPage } from './blockedPage.js'

const CLOUDFLARE = `# Just a moment...

![Icon for academic.oup.com](/favicon.ico)

# academic.oup.com

## Performing security verification

This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.

## Verification successful. Waiting for academic.oup.com to respond`

const RESEARCHGATE = `# Access restricted

We've detected unusual activity from your network. Access to this page is temporarily restricted.

Ray ID: a3b8009ebb25eec8

© 2008-2026 ResearchGate GmbH. All rights reserved.`

test('a Cloudflare challenge page is blocked', () => {
  assert.equal(isBlockedPage(CLOUDFLARE), true)
})

test('a ResearchGate access wall is blocked', () => {
  assert.equal(isBlockedPage(RESEARCHGATE), true)
})

test('a short real review is kept', () => {
  assert.equal(
    isBlockedPage(
      'Cameron stages the chases with a clarity few action films manage, and Hamilton gives the sequel its gravity.'
    ),
    false
  )
})

// The reason the length bound exists: an article about a film that takes place
// behind a security check says the words and is still an article.
test('a long page that merely mentions a security check is kept', () => {
  const article = `${'The heist sequence is built around a security check. '.repeat(40)}Performing security verification is what the guard says.`
  assert.ok(article.length > BLOCKED_PAGE_MAX_CHARS)
  assert.equal(isBlockedPage(article), false)
})

test('empty text is not a wall', () => {
  assert.equal(isBlockedPage(''), false)
  assert.equal(isBlockedPage(null), false)
  assert.equal(isBlockedPage(undefined), false)
})
