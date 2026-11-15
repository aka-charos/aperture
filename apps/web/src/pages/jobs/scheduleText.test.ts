import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TFunction } from 'i18next'
import en from '../../i18n/locales/en/translation.json' with { type: 'json' }
import { describeSchedule, scheduleTextValues } from './scheduleText'
import type { JobSchedule } from './types'

const ui = (en as { admin: { jobsPage: { ui: Record<string, string> } } }).admin.jobsPage.ui

/** English strings with i18next's {{name}} filling; enough for these keys. */
const t = ((key: string, options: Record<string, unknown> = {}) => {
  const text = ui[key.replace('admin.jobsPage.ui.', '')] ?? key
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
}) as unknown as TFunction

const schedule = (over: Partial<JobSchedule>): JobSchedule => ({
  type: 'daily',
  hour: 2,
  minute: 0,
  dayOfWeek: null,
  daysOfWeek: null,
  intervalHours: null,
  intervalMinutes: null,
  isEnabled: true,
  formatted: '',
  ...over,
})

const say = (over: Partial<JobSchedule>) => describeSchedule(scheduleTextValues(schedule(over)), t, 'en-US')

describe('describeSchedule', () => {
  it('describes the stored schedule, not a fixed one', () => {
    assert.equal(say({ type: 'weekly', hour: 10, daysOfWeek: [0] }), 'Runs every Sunday at 10:00 AM')
    assert.equal(say({ type: 'daily', hour: 2, minute: 30 }), 'Runs daily at 2:30 AM')
  })

  it('lists weekly days in week order', () => {
    assert.equal(say({ type: 'weekly', hour: 4, daysOfWeek: [4, 1] }), 'Runs every Monday, Thursday at 4:00 AM')
  })

  it('reads the scalar day of a schedule saved before multi-day existed', () => {
    assert.equal(say({ type: 'weekly', hour: 4, dayOfWeek: 3, daysOfWeek: null }), 'Runs every Wednesday at 4:00 AM')
  })

  it('gives sub-hour intervals no minute and longer ones their offset', () => {
    assert.equal(say({ type: 'interval', intervalMinutes: 15, minute: 7 }), ui.intervalEvery15m)
    assert.equal(say({ type: 'interval', intervalHours: 6, minute: 5 }), `${ui.intervalEvery6h} at :05`)
  })

  it('says a switched-off schedule is off', () => {
    assert.equal(say({ isEnabled: false }), ui.configPreviewDisabled)
  })
})
