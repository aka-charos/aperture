import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EVENT_PREFERENCE,
  NOTIFICATION_EVENTS,
  OWN_ACTION_MS,
  SETTLE_MS,
  checkWindow,
  deviceSignedOut,
  emailReachability,
  eventsFor,
  parsePreferenceUpdate,
  preferenceForChoice,
  readDeviceReport,
  readPreferences,
  requestChangeNotifies,
} from './rules.js'
import { NOTIFICATION_STRINGS_EN, NOTIFICATION_STRING_TRANSLATIONS, notificationText } from './strings.js'

test('no stored choice means app on and email off, for every event', () => {
  assert.deepEqual(DEFAULT_EVENT_PREFERENCE, { email: false, app: true })
  const preferences = readPreferences([])
  for (const event of NOTIFICATION_EVENTS) assert.deepEqual(preferences[event], { email: false, app: true })
  assert.deepEqual(eventsFor(preferences, 'email'), [])
  assert.deepEqual(eventsFor(preferences, 'app'), [...NOTIFICATION_EVENTS])
})

test('stored rows override the defaults and unknown events are ignored', () => {
  const preferences = readPreferences([
    { event: 'requests', email: true, app: false },
    { event: 'retired', email: true, app: true },
  ])
  assert.deepEqual(preferences.requests, { email: true, app: false })
  assert.deepEqual(eventsFor(preferences, 'email'), ['requests'])
  assert.equal('retired' in preferences, false)
})

test('a preference update is refused rather than partly stored', () => {
  assert.equal(parsePreferenceUpdate({ preferences: [{ event: 'nope', email: true, app: true }] }).ok, false)
  assert.equal(parsePreferenceUpdate({ preferences: [{ event: 'requests', email: 'yes', app: true }] }).ok, false)
  assert.equal(
    parsePreferenceUpdate({
      preferences: [
        { event: 'requests', email: true, app: true },
        { event: 'requests', email: false, app: true },
      ],
    }).ok,
    false
  )
  assert.equal(parsePreferenceUpdate({}).ok, false)
  const parsed = parsePreferenceUpdate({ preferences: [{ event: 'watchThis', email: true, app: false }] })
  assert.deepEqual(parsed, { ok: true, rows: [{ event: 'watchThis', email: true, app: false }] })
})

test('the first-run answers set the channels they name', () => {
  assert.deepEqual(preferenceForChoice('phone'), { email: false, app: true })
  assert.deepEqual(preferenceForChoice('email'), { email: true, app: false })
  assert.deepEqual(preferenceForChoice('both'), { email: true, app: true })
  assert.deepEqual(preferenceForChoice('none'), { email: false, app: false })
})

test('a first check reports nothing and later windows trail the clock', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  assert.equal(checkWindow(null, now), null)
  assert.equal(checkWindow(new Date('not a date'), now), null)
  const since = new Date('2026-10-30T11:00:00Z')
  const window = checkWindow(since, now)!
  assert.equal(window.since.getTime(), since.getTime())
  assert.equal(window.until.getTime(), now.getTime() - SETTLE_MS)
})

test('a cursor from the future reports nothing rather than everything', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  const window = checkWindow(new Date('2026-11-30T12:00:00Z'), now)!
  assert.equal(window.since.getTime(), window.until.getTime())
})

test('a request notifies only when someone else moved it to an outcome', () => {
  const created = new Date('2026-10-30T12:00:00Z')
  const later = new Date(created.getTime() + OWN_ACTION_MS + 1)
  const atOnce = new Date(created.getTime() + 5_000)
  assert.equal(requestChangeNotifies('approved', created, later), true)
  assert.equal(requestChangeNotifies('declined', created, later), true)
  assert.equal(requestChangeNotifies('available', created, later), true)
  // Auto-approved as it was made: the person did that themselves.
  assert.equal(requestChangeNotifies('approved', created, atOnce), false)
  assert.equal(requestChangeNotifies('submitted', created, later), false)
  assert.equal(requestChangeNotifies('failed', created, later), false)
  assert.equal(requestChangeNotifies('approved', created, null), false)
})

test('email needs access, a real address and the admin permission, in that order', () => {
  const base = { email: 'a@example.com', emailAllowed: true, isEnabled: true, providerDisabled: false }
  assert.equal(emailReachability(base), null)
  assert.equal(emailReachability({ ...base, isEnabled: false }), 'noAccess')
  assert.equal(emailReachability({ ...base, providerDisabled: true }), 'noAccess')
  assert.equal(emailReachability({ ...base, email: null }), 'noAddress')
  assert.equal(emailReachability({ ...base, email: 'not an address' }), 'noAddress')
  assert.equal(emailReachability({ ...base, emailAllowed: false }), 'notAllowed')
})

test('a phone counts as signed out only past the sign-in lifetime', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  const day = 24 * 60 * 60 * 1000
  assert.equal(deviceSignedOut(new Date(now.getTime() - 29 * day), now), false)
  assert.equal(deviceSignedOut(new Date(now.getTime() - 31 * day), now), true)
})

test('a device report needs a uuid install id and keeps only bounded text', () => {
  assert.equal(readDeviceReport('phone-1', {}), null)
  const report = readDeviceReport('6F9619FF-8B86-D011-B42D-00C04FC964FF', {
    model: '  Pixel 9  ',
    androidVersion: '',
    appVersion: 'x'.repeat(200),
    notificationsAllowed: 'yes',
  })!
  assert.equal(report.id, '6f9619ff-8b86-d011-b42d-00c04fc964ff')
  assert.equal(report.model, 'Pixel 9')
  assert.equal(report.androidVersion, null)
  assert.equal(report.appVersion?.length, 80)
  assert.equal(report.notificationsAllowed, false)
})

test('every translation keeps the English placeholders and falls back per key', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
  for (const [locale, strings] of Object.entries(NOTIFICATION_STRING_TRANSLATIONS)) {
    for (const [key, text] of Object.entries(strings)) {
      const english = NOTIFICATION_STRINGS_EN[key as keyof typeof NOTIFICATION_STRINGS_EN]
      assert.ok(english, `${locale} translates an unknown key ${key}`)
      assert.deepEqual(placeholders(text!), placeholders(english), `${locale} ${key}`)
    }
  }
  // Greek leaves watchThis.body untranslated; English stands in for it.
  assert.equal(notificationText('el', 'watchThis.body', { title: 'Heat' }), 'Heat')
  assert.equal(notificationText('xx', 'requests.available.title'), 'Now available')
  assert.equal(notificationText('el-GR', 'requests.available.title'), 'Διαθέσιμο τώρα')
})
