/**
 * The order of a restore's steps, which is what keeps the data safe. The transaction
 * itself is pinned in restore.test.ts; these say what may and may not reach it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// An address nothing listens on: writing the job's history row fails at once, and
// its failure is logged rather than thrown.
process.env.DATABASE_URL ??= 'postgres://backup:test@127.0.0.1:1/backup_test'

const { restoreBackup } = await import('./backupService.js')
const { isRestoreInProgress } = await import('./restore.js')
const { getJobProgress } = await import('../jobs/progress.js')

type Steps = NonNullable<NonNullable<Parameters<typeof restoreBackup>[3]>['steps']>

function sandbox(overrides: Steps = {}) {
  const backupPath = mkdtempSync(join(tmpdir(), 'aperture-backup-service-'))
  writeFileSync(join(backupPath, 'candidate.dump'), 'PGDMP')
  const calls: string[] = []
  const steps: Steps = {
    getBackupConfig: async () => ({ backupPath }),
    validateBackup: async () => ({ valid: true }),
    createBackup: async (_jobId, options) => {
      calls.push(`safety prune=${String(options?.prune)}`)
      return { success: true, filename: 'safety.dump' }
    },
    restoreInTransaction: async () => {
      calls.push('apply')
    },
    ...overrides,
  }
  return { steps, calls, cleanup: () => rmSync(backupPath, { recursive: true, force: true }) }
}

test('a failed safety backup stops the restore before anything is applied', async () => {
  let applied = false
  const { steps, cleanup } = sandbox({
    createBackup: async () => ({ success: false, error: 'pg_dump exited with 1' }),
    restoreInTransaction: async () => {
      applied = true
    },
  })
  const jobId = randomUUID()
  try {
    const result = await restoreBackup('candidate.dump', true, jobId, { steps })

    assert.equal(applied, false)
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /safety backup failed.*pg_dump exited with 1/)
    // What the panel reads: a failure with the reason, not a job left running.
    const progress = getJobProgress(jobId)
    assert.equal(progress?.status, 'failed')
    assert.match(progress?.error ?? '', /safety backup failed/)
    assert.equal(isRestoreInProgress(), false, 'the next attempt must not be refused')
  } finally {
    cleanup()
  }
})

test('the safety backup comes first and cannot prune the file being restored', async () => {
  const { steps, calls, cleanup } = sandbox()
  try {
    const result = await restoreBackup('candidate.dump', true, undefined, { steps })

    assert.deepEqual(calls, ['safety prune=false', 'apply'])
    assert.equal(result.success, true)
    assert.equal(result.preRestoreBackup, 'safety.dump')
  } finally {
    cleanup()
  }
})

test('a backup that fails validation never reaches the safety backup or the database', async () => {
  const { steps, calls, cleanup } = sandbox({
    validateBackup: async () => ({ valid: false, error: 'File is empty' }),
  })
  try {
    const result = await restoreBackup('candidate.dump', true, undefined, { steps })

    assert.deepEqual(calls, [])
    assert.equal(result.success, false)
    assert.match(result.error ?? '', /File is empty/)
  } finally {
    cleanup()
  }
})

test('a failed apply ends as a failure the panel can read, and frees the claim', async () => {
  const { steps, cleanup } = sandbox({
    restoreInTransaction: async () => {
      throw new Error('psql exited with 3: ERROR: boom')
    },
  })
  const jobId = randomUUID()
  try {
    const result = await restoreBackup('candidate.dump', false, jobId, { steps })

    assert.equal(result.success, false)
    assert.equal(getJobProgress(jobId)?.status, 'failed')
    assert.match(getJobProgress(jobId)?.error ?? '', /ERROR: boom/)
    assert.equal(isRestoreInProgress(), false)
  } finally {
    cleanup()
  }
})

test('a finished restore ends as a success the panel can read, and frees the claim', async () => {
  const { steps, cleanup } = sandbox()
  const jobId = randomUUID()
  try {
    const result = await restoreBackup('candidate.dump', false, jobId, { steps })

    assert.equal(result.success, true)
    assert.equal(getJobProgress(jobId)?.status, 'completed')
    assert.equal(isRestoreInProgress(), false)
  } finally {
    cleanup()
  }
})

test('a second restore is refused while one runs, and leaves the first one\'s claim alone', async () => {
  let finishFirst = () => {}
  let firstApplying = () => {}
  const applying = new Promise<void>((resolve) => {
    firstApplying = resolve
  })
  const applies: string[] = []
  const first = sandbox({
    restoreInTransaction: async () => {
      applies.push('first')
      firstApplying()
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
    },
  })
  const second = sandbox({
    restoreInTransaction: async () => {
      applies.push('second')
    },
  })
  try {
    const running = restoreBackup('candidate.dump', false, undefined, { steps: first.steps })
    await applying

    const refused = await restoreBackup('candidate.dump', false, undefined, { steps: second.steps })
    assert.equal(refused.success, false)
    assert.match(refused.error ?? '', /already running/)
    assert.equal(isRestoreInProgress(), true, 'the first restore still holds it')

    finishFirst()
    assert.equal((await running).success, true)
    assert.deepEqual(applies, ['first'])
    assert.equal(isRestoreInProgress(), false)
  } finally {
    first.cleanup()
    second.cleanup()
  }
})
