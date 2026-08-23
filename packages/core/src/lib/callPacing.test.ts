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

import { reserveSlot, waitForCallSlot, resetCallPacing } from './callPacing.js'

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
