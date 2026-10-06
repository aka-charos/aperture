/**
 * Pins the slot arithmetic.
 *
 * The property worth testing is the concurrent one: two callers arriving in the
 * same millisecond must be given different slots. A timestamp-based
 * implementation passes every single-caller test and fails exactly there, which
 * is the case pacing exists for — the on-demand button pressed while the batch
 * job is running.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  reserveSlot,
  waitForCallSlot,
  resetCallPacing,
  providerHasRateLimit,
  resolveSpacingMs,
  spacingMsForAttempt,
  storableCallSpacingSeconds,
  PROVIDERS_WITHOUT_RATE_LIMIT,
  MAX_CALL_SPACING_SECONDS,
} from './callPacing.js'

const marker = (nextAllowedAt: number, issuedAt: number) => ({ nextAllowedAt, issuedAt })

describe('reserveSlot', () => {
  test('the first call is not delayed', () => {
    const r = reserveSlot(undefined, 1_000, 60_000)
    assert.equal(r.startAt, 1_000)
    assert.equal(r.marker.nextAllowedAt, 61_000)
  })

  test('a call inside the window waits out the remainder', () => {
    const r = reserveSlot(marker(61_000, 1_000), 30_000, 60_000)
    assert.equal(r.startAt, 61_000)
  })

  test('a call after the window is not delayed', () => {
    const r = reserveSlot(marker(61_000, 1_000), 90_000, 60_000)
    assert.equal(r.startAt, 90_000)
    assert.equal(r.marker.nextAllowedAt, 150_000)
  })

  test('concurrent callers are queued, not stacked', () => {
    // The whole point, and the one property a last-call-timestamp design gets
    // wrong: three callers arriving in the same millisecond get three slots,
    // not one shared start that fires three requests at once.
    const first = reserveSlot(undefined, 0, 60_000)
    const second = reserveSlot(first.marker, 0, 60_000)
    const third = reserveSlot(second.marker, 0, 60_000)
    assert.equal(first.startAt, 0)
    assert.equal(second.startAt, 60_000)
    assert.equal(third.startAt, 120_000)
  })

  test('spacing off is a no-op, and records no future', () => {
    const r = reserveSlot(marker(999_999, 0), 1_000, 0)
    assert.equal(r.startAt, 1_000)
    assert.equal(r.marker.nextAllowedAt, 1_000)
  })

  test('a backwards clock cannot park a job', () => {
    // NTP correction or a resumed host: the stored marker was issued at a
    // reading later than the one we now have, so it is measured against a
    // clock that no longer exists. Honouring it would park the job for the
    // length of the jump.
    const jumped = reserveSlot(marker(9_000_000, 8_940_000), 1_000, 60_000)
    assert.equal(jumped.startAt, 1_000, 'served a wait from a stale clock')

    // ... and a marker from BEFORE now is still honoured, or the guard would
    // simply disable pacing.
    const normal = reserveSlot(marker(61_000, 1_000), 30_000, 60_000)
    assert.equal(normal.startAt, 61_000)
  })
})

describe('waitForCallSlot', () => {
  test('off means no wait and no bookkeeping', async () => {
    resetCallPacing()
    const result = await waitForCallSlot('provider:test', 0)
    assert.equal(result.cancelled, false)
    assert.equal(result.waitedMs, 0)
  })

  test('the first call through a gate does not wait', async () => {
    resetCallPacing()
    const started = Date.now()
    const result = await waitForCallSlot('provider:first', 5_000)
    assert.equal(result.cancelled, false)
    assert.ok(Date.now() - started < 200, 'first call was delayed')
  })

  test('cancellation lands inside the wait, not after it', async () => {
    // A minute-long cool-off that ignores Stop is a button that does not work.
    resetCallPacing()
    await waitForCallSlot('provider:cancel', 60_000)
    const started = Date.now()
    const result = await waitForCallSlot('provider:cancel', 60_000, {
      shouldCancel: () => true,
    })
    assert.equal(result.cancelled, true)
    assert.ok(Date.now() - started < 2_000, 'Stop waited out the cool-off')
  })

  test('announces the wait before serving it', async () => {
    resetCallPacing()
    await waitForCallSlot('provider:notice', 30_000)
    let announced: number | null = null
    const result = await waitForCallSlot('provider:notice', 30_000, {
      onWait: (seconds) => {
        announced = seconds
      },
      shouldCancel: () => true,
    })
    assert.equal(result.cancelled, true)
    assert.ok(announced !== null, 'the wait was silent')
    assert.ok((announced as unknown as number) > 25, 'announced far less than it would wait')
  })

  test('gates are per key', async () => {
    resetCallPacing()
    await waitForCallSlot('provider:a', 60_000)
    const started = Date.now()
    const result = await waitForCallSlot('provider:b', 60_000)
    assert.equal(result.waitedMs, 0)
    assert.ok(Date.now() - started < 200, 'one provider delayed another')
  })
})

describe('pacing and local providers', () => {
  test('LM Studio and Ollama have no rate limit; hosted providers and gateways do', () => {
    assert.equal(providerHasRateLimit('lmstudio'), false)
    assert.equal(providerHasRateLimit('ollama'), false)
    for (const p of ['openrouter', 'google', 'openai', 'zai', 'groq', 'deepseek']) {
      assert.equal(providerHasRateLimit(p), true, p)
    }
    // A hosted gateway is reached through this provider and cannot be told
    // apart from a local server, so it keeps the option.
    assert.equal(providerHasRateLimit('openai-compatible'), true)
    // Unknown reads as "has one": wrongly hiding the setting strands someone.
    assert.equal(providerHasRateLimit(undefined), true)
    assert.equal(providerHasRateLimit(null), true)
  })

  test('the list is exactly the two providers it claims', () => {
    assert.deepEqual([...PROVIDERS_WITHOUT_RATE_LIMIT].sort(), ['lmstudio', 'ollama'])
  })

  test('a stored value never delays a local provider', () => {
    assert.equal(resolveSpacingMs('lmstudio', 60), 0)
    assert.equal(resolveSpacingMs('ollama', 60), 0)
    assert.equal(resolveSpacingMs('openrouter', 60), 60_000)
  })

  test('off, malformed and absurd values still resolve as before', () => {
    assert.equal(resolveSpacingMs('openrouter', undefined), 0)
    assert.equal(resolveSpacingMs('openrouter', 0), 0)
    assert.equal(resolveSpacingMs('openrouter', -5), 0)
    assert.equal(resolveSpacingMs('openrouter', Number.NaN), 0)
    assert.equal(resolveSpacingMs('openrouter', '30'), 0)
    assert.equal(resolveSpacingMs('openrouter', 10 ** 9), MAX_CALL_SPACING_SECONDS * 1000)
  })

  test('a spare is paced only when it shares the role provider account', () => {
    // Primary on OpenRouter, paced.
    assert.equal(spacingMsForAttempt('openrouter', 20, 'openrouter'), 20_000)
    assert.equal(spacingMsForAttempt('openrouter', 20, 'lmstudio'), 0)
    assert.equal(spacingMsForAttempt('openrouter', 20, 'ollama'), 0)
    assert.equal(spacingMsForAttempt('openrouter', 20, 'google'), 0)
    // Primary local: nothing is paced, including a stale stored number.
    assert.equal(spacingMsForAttempt('lmstudio', 20, 'lmstudio'), 0)
    assert.equal(spacingMsForAttempt('lmstudio', 20, 'openrouter'), 0)
    // No role config at all.
    assert.equal(spacingMsForAttempt(undefined, undefined, 'openrouter'), 0)
  })

  test('a local provider never keeps a stored value; a hosted one keeps it as before', () => {
    assert.equal(storableCallSpacingSeconds('lmstudio', 30), undefined)
    assert.equal(storableCallSpacingSeconds('ollama', 30), undefined)
    assert.equal(storableCallSpacingSeconds('openrouter', 30), 30)
    assert.equal(storableCallSpacingSeconds('openai-compatible', 30), 30)
    // Off is absent rather than 0.
    assert.equal(storableCallSpacingSeconds('openrouter', 0), undefined)
    assert.equal(storableCallSpacingSeconds('openrouter', undefined), undefined)
    assert.equal(storableCallSpacingSeconds('openrouter', 12.4), 12)
    assert.equal(storableCallSpacingSeconds('openrouter', 10 ** 9), MAX_CALL_SPACING_SECONDS)
  })
})

describe('the web mirror', () => {
  test('the bundle hides the option for exactly the providers core ignores', () => {
    // The web bundle never imports core, so its list is a hand copy — and a
    // copy that drifts shows a control the server then ignores, or hides one
    // the server would have honoured.
    const file = fileURLToPath(
      new URL('../../../../apps/web/src/components/aiProviderInfo.ts', import.meta.url)
    )
    const source = readFileSync(file, 'utf8')
    const match = /PROVIDERS_WITHOUT_RATE_LIMIT:[^=]*=\s*\[([^\]]*)\]/.exec(source)
    assert.ok(match, 'PROVIDERS_WITHOUT_RATE_LIMIT not found in the web bundle')
    const mirrored = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(mirrored, [...PROVIDERS_WITHOUT_RATE_LIMIT].sort())
  })
})
