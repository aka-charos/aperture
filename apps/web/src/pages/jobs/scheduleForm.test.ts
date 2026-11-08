import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTimeOfDay,
  parseMinute,
  scheduleTakesMinute,
  scheduleTimingPayload,
} from './scheduleForm'

describe('scheduleTimingPayload', () => {
  it('keeps the minute of a daily or weekly job instead of resetting it to :00', () => {
    for (const type of ['daily', 'weekly', 'biweekly'] as const) {
      assert.deepEqual(scheduleTimingPayload({ type, hour: 5, minute: 45, intervalMinutes: 360 }), {
        scheduleHour: 5,
        scheduleMinute: 45,
      })
    }
  })

  it('keeps the minute offset of an hourly-or-longer interval', () => {
    assert.deepEqual(
      scheduleTimingPayload({ type: 'interval', hour: 3, minute: 10, intervalMinutes: 180 }),
      { scheduleHour: null, scheduleMinute: 10, scheduleIntervalHours: 3 }
    )
  })

  it('sends no minute for a sub-hour interval or manual', () => {
    assert.deepEqual(
      scheduleTimingPayload({ type: 'interval', hour: 3, minute: 10, intervalMinutes: 15 }),
      { scheduleHour: null, scheduleMinute: null, scheduleIntervalMinutes: 15 }
    )
    assert.deepEqual(scheduleTimingPayload({ type: 'manual', hour: 3, minute: 10, intervalMinutes: 60 }), {
      scheduleHour: null,
      scheduleMinute: null,
    })
  })

  it('a minute of 0 is kept as 0, not dropped', () => {
    assert.equal(
      scheduleTimingPayload({ type: 'daily', hour: 2, minute: 0, intervalMinutes: 360 }).scheduleMinute,
      0
    )
  })
})

describe('scheduleTakesMinute', () => {
  it('only where the cron uses it', () => {
    assert.equal(scheduleTakesMinute('daily', 360), true)
    assert.equal(scheduleTakesMinute('interval', 60), true)
    assert.equal(scheduleTakesMinute('interval', 30), false)
    assert.equal(scheduleTakesMinute('manual', 360), false)
  })
})

describe('parseMinute', () => {
  it('reads 0 to 59 and refuses the rest', () => {
    assert.equal(parseMinute('0'), 0)
    assert.equal(parseMinute(' 07 '), 7)
    assert.equal(parseMinute('59'), 59)
    for (const bad of ['', '60', '-1', '1.5', 'ten', '100']) assert.equal(parseMinute(bad), undefined, bad)
  })
})

describe('formatTimeOfDay', () => {
  it('formats the picker and the preview the same way, ignoring the browser zone', () => {
    assert.equal(formatTimeOfDay('en-US', 5, 45), '5:45 AM')
    assert.equal(formatTimeOfDay('en-GB', 17, 5), '17:05')
  })
})
