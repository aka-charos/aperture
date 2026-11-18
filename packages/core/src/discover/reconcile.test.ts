import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MARK_DELETED_IN_SEERR_SQL,
  RESTORE_STATUS_DATE_SQL,
  applyLiveRecord,
  cursorAfter,
  keyedBatchSql,
  parseSweepCursors,
  planLiveRecord,
  resolveRequestStatus,
  restoreKeepsStatusStamp,
} from './reconcile.js'

/**
 * The point of reconciliation is that a request Seerr declined must reach a
 * TERMINAL status, because getRequestedTmdbIds excludes every non-terminal
 * request from discovery -- so a request stuck at 'submitted' suppresses its
 * title forever.
 */

test('a decline in Seerr becomes declined, so the title can be suggested again', () => {
  assert.equal(
    resolveRequestStatus('submitted', { status: 'declined', mediaStatus: 'unknown' }),
    'declined'
  )
})

test('media availability outranks request state', () => {
  // An approved request whose media has finished importing is 'available', and
  // that is the more useful fact to record.
  assert.equal(
    resolveRequestStatus('approved', { status: 'approved', mediaStatus: 'available' }),
    'available'
  )
  // Even a still-pending request can have available media (someone else asked
  // for the same title first).
  assert.equal(
    resolveRequestStatus('submitted', { status: 'pending', mediaStatus: 'available' }),
    'available'
  )
})

test('approval is recorded', () => {
  assert.equal(
    resolveRequestStatus('submitted', { status: 'approved', mediaStatus: 'processing' }),
    'approved'
  )
})

test('a still-pending request never walks backwards', () => {
  // 'submitted' is our own word for Seerr's 'pending', so seeing 'pending'
  // again must not undo it -- an oscillating status would rewrite updated_at on
  // every sweep and make the reconcile log unreadable.
  assert.equal(
    resolveRequestStatus('submitted', { status: 'pending', mediaStatus: 'pending' }),
    'submitted'
  )
  assert.equal(
    resolveRequestStatus('approved', { status: 'pending', mediaStatus: 'processing' }),
    'approved'
  )
})

test('a fresh pending row advances to submitted once Seerr acknowledges it', () => {
  assert.equal(
    resolveRequestStatus('pending', { status: 'pending', mediaStatus: 'unknown' }),
    'submitted'
  )
})

test('partially_available is not treated as available', () => {
  // A part-imported series is still worth tracking; only a full import is a
  // terminal 'available'.
  assert.equal(
    resolveRequestStatus('approved', { status: 'approved', mediaStatus: 'partially_available' }),
    'approved'
  )
})

test('a completed request is available even while the show is only partly available', () => {
  assert.equal(
    resolveRequestStatus('approved', { status: 'completed', mediaStatus: 'partially_available' }),
    'available'
  )
})

test('a row recorded as failed follows Seerr when Seerr still holds the request', () => {
  // Seerr missing one answer used to be written down as a deleted request; the
  // request carried on in Seerr while the list called it failed.
  assert.equal(
    resolveRequestStatus('failed', { status: 'approved', mediaStatus: 'processing' }),
    'approved'
  )
  assert.equal(
    resolveRequestStatus('failed', { status: 'pending', mediaStatus: 'unknown' }),
    'submitted'
  )
})

test('a restore to the status the row held before failing is a correction, not news', () => {
  // Already announced when it first happened: no second "approved".
  assert.equal(restoreKeepsStatusStamp('approved', 'approved', null, null), true)
  assert.equal(restoreKeepsStatusStamp('submitted', 'submitted', null, null), true)
  // A different status is a decision made since: announced now.
  assert.equal(restoreKeepsStatusStamp('approved', 'submitted', null, null), false)
  assert.equal(restoreKeepsStatusStamp('declined', 'approved', null, null), false)
  // A failed row was never available, so that is news whatever it held.
  assert.equal(restoreKeepsStatusStamp('available', 'approved', null, null), false)
})

test('a row failed before 0225 falls back to the dates, and announces when unsure', () => {
  const failedAt = new Date('2026-10-20T04:30:00Z')
  const before = new Date('2026-10-19T12:00:00Z')
  const after = new Date('2026-10-25T09:00:00Z')
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, before), true)
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, after), false)
  assert.equal(restoreKeepsStatusStamp('approved', null, null, before), false)
  assert.equal(restoreKeepsStatusStamp('approved', null, failedAt, undefined), false)
})

const live = (status: 'pending' | 'approved' | 'declined' | 'completed', mediaStatus = 'unknown') =>
  ({ status, mediaStatus }) as Parameters<typeof planLiveRecord>[2]

type Held = NonNullable<Parameters<typeof planLiveRecord>[1]>

const heldRow = (status: string, extra: Partial<Held> = {}): Held => ({
  status: status as Held['status'],
  statusChangedAt: null,
  failedFrom: null,
  failedFromChangedAt: null,
  ...extra,
})

test('the writer never writes over a status someone recorded since it was read', () => {
  // Read as submitted, an admin declined it meanwhile: the older live answer loses.
  assert.deepEqual(planLiveRecord('submitted', heldRow('declined'), live('approved')), {
    write: false,
    status: 'declined',
  })
  // Gone meanwhile: nothing to write, the caller keeps what it read.
  assert.deepEqual(planLiveRecord('submitted', null, live('approved')), { write: false, status: 'submitted' })
})

test('the writer plans an ordinary move, a restore, or nothing', () => {
  assert.deepEqual(planLiveRecord('submitted', heldRow('submitted'), live('approved')), {
    write: true,
    next: 'approved',
    restore: false,
  })
  assert.deepEqual(planLiveRecord('approved', heldRow('approved'), live('approved', 'processing')), {
    write: false,
    status: 'approved',
  })
  assert.deepEqual(
    planLiveRecord('failed', heldRow('failed', { failedFrom: 'approved' }), live('approved', 'available')),
    { write: true, next: 'available', restore: true }
  )
})

test('a restore to the status it held puts back the date that status was reached', () => {
  const approvedAt = new Date('2026-09-01T10:00:00Z')
  const failedAt = new Date('2026-10-20T04:30:00Z')
  // Not the failure's date: that one can still be inside a notification window.
  assert.deepEqual(
    planLiveRecord(
      'failed',
      heldRow('failed', { failedFrom: 'approved', failedFromChangedAt: approvedAt, statusChangedAt: failedAt }),
      live('approved', 'processing')
    ),
    { write: true, next: 'approved', restore: true, keepStampAt: approvedAt }
  )
  // Failed before 0225: the failure's own date, as before.
  const seerrBefore = { ...live('approved', 'processing'), updatedAt: new Date('2026-10-19T00:00:00Z') }
  assert.deepEqual(planLiveRecord('failed', heldRow('failed', { statusChangedAt: failedAt }), seerrBefore), {
    write: true,
    next: 'approved',
    restore: true,
    keepStampAt: failedAt,
  })
})

/** A connection that answers the lock read with `held` and records every statement. */
function recordingClient(held: Record<string, unknown> | null) {
  const statements: { sql: string; params: unknown[] }[] = []
  return {
    statements,
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params })
      return { rows: /FOR UPDATE/.test(sql) && held ? [held] : [] }
    },
  }
}

const unfailed = { status_changed_at: null, failed_from: null, failed_from_changed_at: null }

test('a restore writes the status, then the kept date, on the locked connection', async () => {
  const approvedAt = new Date('2026-09-01T10:00:00Z')
  const client = recordingClient({
    status: 'failed',
    status_changed_at: new Date('2026-10-20T04:30:00Z'),
    failed_from: 'approved',
    failed_from_changed_at: approvedAt,
  })
  const recorded = await applyLiveRecord(client, { id: 'r1', status: 'failed' }, live('approved', 'processing'))
  assert.deepEqual(recorded, { status: 'approved', wrote: true })
  assert.equal(client.statements.length, 3)
  assert.match(client.statements[0]!.sql, /FOR UPDATE/)
  assert.match(client.statements[1]!.sql, /SET status = \$2, status_message = NULL/)
  assert.deepEqual(client.statements[1]!.params, ['r1', 'approved'])
  assert.equal(client.statements[2]!.sql, RESTORE_STATUS_DATE_SQL)
  assert.deepEqual(client.statements[2]!.params, ['r1', approvedAt])
})

test('a move someone else recorded first is reported, not written', async () => {
  const client = recordingClient({ status: 'declined', ...unfailed })
  const recorded = await applyLiveRecord(client, { id: 'r1', status: 'submitted' }, live('approved'))
  assert.deepEqual(recorded, { status: 'declined', wrote: false })
  assert.equal(client.statements.length, 1)
})

test('an ordinary move goes through the shared status writer on the same connection', async () => {
  const client = recordingClient({ status: 'submitted', ...unfailed })
  const recorded = await applyLiveRecord(client, { id: 'r1', status: 'submitted' }, live('approved'))
  assert.deepEqual(recorded, { status: 'approved', wrote: true })
  assert.equal(client.statements.length, 2)
  assert.match(client.statements[1]!.sql, /seerr_unconfirmed_since = CASE WHEN \$2 = 'pending'/)
  assert.equal(client.statements[1]!.params[1], 'approved')
})

test('marking a deletion keeps the status it held and when, only over the status read', () => {
  // In a SET list a column reads the row as it was, before the trigger stamps.
  assert.match(MARK_DELETED_IN_SEERR_SQL, /failed_from = status,/)
  assert.match(MARK_DELETED_IN_SEERR_SQL, /failed_from_changed_at = status_changed_at,/)
  assert.match(MARK_DELETED_IN_SEERR_SQL, /WHERE id = \$1 AND status = \$2/)
})

const migration = (name: string) => readFileSync(new URL(`../../../../db/migrations/${name}`, import.meta.url), 'utf8')

test('the triggers the restore relies on', () => {
  // Putting a date back is a write with the status unchanged: the stamp trigger
  // must move the date only when the status changes, or every kept date is lost.
  assert.match(
    migration('0215_notifications.sql'),
    /IF NEW\.status IS DISTINCT FROM OLD\.status THEN\s+NEW\.status_changed_at = NOW\(\);/
  )
  // Leaving failed clears what the failure recorded, whichever writer moves it.
  const failedFrom = migration('0225_discovery_request_failed_from.sql')
  assert.match(
    failedFrom,
    /IF NEW\.status IS DISTINCT FROM 'failed' THEN\s+NEW\.failed_from = NULL;\s+NEW\.failed_from_changed_at = NULL;/
  )
  assert.match(failedFrom, /BEFORE UPDATE ON discovery_requests/)
})

test('each sweep reads on from its cursor, then wraps to the start', () => {
  const sql = keyedBatchSql(`status = 'failed'`)
  assert.match(sql.after, /WHERE status = 'failed' AND \(\$1::uuid IS NULL OR id > \$1::uuid\) ORDER BY id LIMIT \$2$/)
  assert.match(sql.wrap, /WHERE status = 'failed' AND id <= \$1::uuid ORDER BY id LIMIT \$2$/)
})

test('the cursor stops before the first row Seerr did not answer for', () => {
  const batch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(cursorAfter(batch, new Set(['a', 'b', 'c']), undefined), 'c')
  // An outage at b: b and c are read again next time, not skipped for a round.
  assert.equal(cursorAfter(batch, new Set(['a', 'c']), 'z'), 'a')
  // Nothing answered: the cursor stays where it was.
  assert.equal(cursorAfter(batch, new Set(), 'z'), 'z')
  assert.equal(cursorAfter([], new Set(), undefined), undefined)
})

test('stored cursors are row ids or nothing', () => {
  const id = '3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b'
  assert.deepEqual(parseSweepCursors(JSON.stringify({ live: id, failed: 'x; DROP' })), { live: id })
  assert.deepEqual(parseSweepCursors('not json'), {})
  assert.deepEqual(parseSweepCursors(null), {})
  assert.deepEqual(parseSweepCursors('[1]'), {})
})
