/**
 * The account drift comparison, on small hand-built directories. What these
 * pin: every way the three lists drift apart lands on one row with the right
 * finding, an LLDAP account is never reported twice, nothing is said about
 * LLDAP when it was not read, and the address findings follow what the email
 * import actually does (its own username key, a locked address kept).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAccountDrift,
  DRIFT_FINDINGS,
  type DriftApertureAccount,
  type DriftFindingId,
  type DriftLldapAccount,
  type DriftMediaServerAccount,
  type DriftRow,
} from './accountDrift.js'

const ms = (id: string, name: string, extra: Partial<DriftMediaServerAccount> = {}): DriftMediaServerAccount => ({
  id,
  name,
  disabled: false,
  admin: false,
  lastActivity: null,
  ...extra,
})
const ld = (id: string, email: string | null = `${id}@example.com`, extra: Partial<DriftLldapAccount> = {}): DriftLldapAccount => ({
  id,
  displayName: null,
  email,
  created: null,
  groups: [],
  ...extra,
})
const ap = (
  id: string,
  username: string,
  providerUserId: string | null,
  extra: Partial<DriftApertureAccount> = {}
): DriftApertureAccount => ({
  id,
  username,
  providerUserId,
  email: `${username.toLowerCase()}@example.com`,
  emailLocked: false,
  accessEnabled: true,
  ...extra,
})

const ids = (row: DriftRow | undefined): DriftFindingId[] => (row?.findings ?? []).map((f) => f.id)
const rowNamed = (rows: DriftRow[], name: string) => rows.filter((r) => r.name === name)

test('an account in all three places with the same address is in sync', () => {
  const { rows, summary } = buildAccountDrift({
    mediaServer: [ms('m1', 'Bob')],
    lldap: [ld('bob')],
    aperture: [ap('a1', 'Bob', 'm1')],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'inSync')
  assert.deepEqual(ids(rows[0]), [])
  assert.ok(rows[0].mediaServer && rows[0].lldap && rows[0].aperture)
  assert.equal(summary.inSync, 1)
})

test('deleted from the media server: Aperture keeps the account and LLDAP still has it, on one row', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [],
    lldap: [ld('carol')],
    aperture: [ap('a1', 'carol', 'm-gone')],
  })
  assert.equal(rows.length, 1, 'the LLDAP account is not reported again as a row of its own')
  assert.deepEqual(ids(rows[0]), ['goneFromMediaServer', 'stillInLldap'])
  assert.equal(rows[0].findings[0].vars?.email, 'carol@example.com')
  assert.equal(rows[0].status, 'warning')
})

test('an Aperture account with no media-server id reads as gone, not as a crash', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m1', 'bob')],
    lldap: null,
    aperture: [ap('a1', 'bob', 'm1'), ap('a2', 'local', null, { email: null })],
  })
  const local = rowNamed(rows, 'local')[0]
  assert.deepEqual(ids(local), ['goneFromMediaServer'])
  assert.equal(local.findings[0].vars, undefined, 'no address to name')
})

test('an LLDAP account nobody else has is LLDAP only', () => {
  const { rows } = buildAccountDrift({ mediaServer: [], lldap: [ld('dave')], aperture: [] })
  assert.deepEqual(ids(rows[0]), ['lldapOnly'])
  assert.equal(rows[0].key, 'ld:dave')
})

test('the LLDAP account Aperture signs in with is named as such, not reported as drift', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [],
    lldap: [ld('admin', null), ld('dave')],
    aperture: [],
    lldapServiceAccount: 'Admin',
  })
  assert.deepEqual(ids(rows.find((r) => r.name === 'admin')), ['lldapServiceAccount'])
  assert.equal(rows.find((r) => r.name === 'admin')?.status, 'info')
  assert.deepEqual(ids(rows.find((r) => r.name === 'dave')), ['lldapOnly'])
})

test('a media-server account with no LLDAP account is reported only when LLDAP was read', () => {
  const input = { mediaServer: [ms('m1', 'erin')], aperture: [ap('a1', 'erin', 'm1')] }
  const read = buildAccountDrift({ ...input, lldap: [] })
  assert.deepEqual(ids(read.rows[0]), ['noLldapAccount'])
  assert.equal(read.rows[0].findings[0].vars?.name, 'erin')

  const unread = buildAccountDrift({ ...input, lldap: null })
  assert.deepEqual(ids(unread.rows[0]), [], 'an unread LLDAP says nothing about who is missing from it')
  assert.equal(unread.rows[0].status, 'inSync')
})

test('a person deleted and recreated on the media server leaves the old account as left over, not as still in LLDAP', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m-new', 'frank')],
    lldap: [ld('frank')],
    aperture: [ap('a-new', 'frank', 'm-new'), ap('a-old', 'frank', 'm-old')],
  })
  assert.equal(rows.length, 2)
  const [current, leftover] = [rows.find((r) => r.key === 'ms:m-new'), rows.find((r) => r.key === 'ap:a-old')]
  assert.deepEqual(ids(current), [])
  assert.deepEqual(ids(leftover), ['replacedOnMediaServer'])
  // The import matches by username, so both Aperture accounts get the address.
  assert.equal(leftover?.lldap?.id, 'frank')
  assert.ok(!rows.some((r) => ids(r).includes('lldapOnly')))
})

test('a rename on the media server is named, and the address findings follow the name the import uses', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m1', 'gina2')],
    lldap: [ld('gina', 'gina@new.example')],
    aperture: [ap('a1', 'gina', 'm1', { email: 'gina@old.example' })],
  })
  assert.equal(rows.length, 1)
  assert.deepEqual(ids(rows[0]), ['renamedOnMediaServer', 'emailPending'])
  assert.deepEqual(rows[0].findings[0].vars, { name: 'gina2', oldName: 'gina' })
  assert.equal(rows[0].lldap?.id, 'gina', 'the LLDAP account under the old name is this person')
})

test('names match ignoring case, as the email import matches them', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m1', 'Hank')],
    lldap: [ld('hank')],
    aperture: [ap('a1', 'Hank', 'm1')],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'inSync')
})

test('the address findings: none, unusable, waiting for the import, kept by the person', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m1', 'ivy'), ms('m2', 'jack'), ms('m3', 'kim'), ms('m4', 'lee')],
    lldap: [ld('ivy', ''), ld('jack', 'jack@x.com, jack@y.com'), ld('kim', 'kim@new.example'), ld('lee', 'lee@new.example')],
    aperture: [
      ap('a1', 'ivy', 'm1'),
      ap('a2', 'jack', 'm2'),
      ap('a3', 'kim', 'm3', { email: 'kim@old.example' }),
      ap('a4', 'lee', 'm4', { email: 'lee@mine.example', emailLocked: true }),
    ],
  })
  assert.deepEqual(ids(rowNamed(rows, 'ivy')[0]), ['lldapNoEmail'])
  assert.deepEqual(ids(rowNamed(rows, 'jack')[0]), ['lldapEmailUnusable'])
  assert.equal(rowNamed(rows, 'jack')[0].status, 'warning')
  assert.deepEqual(ids(rowNamed(rows, 'kim')[0]), ['emailPending'])
  assert.equal(rowNamed(rows, 'kim')[0].status, 'info')
  assert.deepEqual(ids(rowNamed(rows, 'lee')[0]), ['emailOverridden'])
  assert.equal(rowNamed(rows, 'lee')[0].findings[0].vars?.email, 'lee@new.example')
})

test('not imported yet and disabled on the media server are notes, not drift', () => {
  const { rows } = buildAccountDrift({
    mediaServer: [ms('m1', 'mia'), ms('m2', 'ned', { disabled: true })],
    lldap: [ld('mia'), ld('ned')],
    aperture: [ap('a2', 'ned', 'm2')],
  })
  assert.deepEqual(ids(rowNamed(rows, 'mia')[0]), ['notImported'])
  assert.deepEqual(ids(rowNamed(rows, 'ned')[0]), ['disabledOnMediaServer'])
  assert.ok(rows.every((r) => r.status === 'info'))
})

test('warnings sort first, and the summary counts what the rows say', () => {
  const { rows, summary } = buildAccountDrift({
    mediaServer: [ms('m1', 'aaron'), ms('m2', 'zoe')],
    lldap: [ld('aaron'), ld('zoe'), ld('orphan')],
    aperture: [ap('a1', 'aaron', 'm1')],
  })
  assert.deepEqual(
    rows.map((r) => r.status),
    ['warning', 'info', 'inSync']
  )
  assert.equal(summary.total, rows.length)
  assert.equal(summary.warning + summary.info + summary.inSync, summary.total)
  const counted = rows.reduce((n, r) => n + r.findings.length, 0)
  assert.equal(
    DRIFT_FINDINGS.reduce((n, id) => n + summary.findings[id], 0),
    counted
  )
  assert.equal(summary.findings.lldapOnly, 1)
  assert.equal(summary.findings.notImported, 1)
})
