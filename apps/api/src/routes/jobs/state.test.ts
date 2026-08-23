import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createJobProgress } from '@aperture/core'
import { activeJobs, claimJob, releaseJob, decideClaim } from './state.js'

/**
 * The double-run these pin is not hypothetical. On 2026-08-21 a cancelled
 * `generate-movie-recommendations` kept running -- cancellation is cooperative
 * and that loop did not poll -- while a replacement was admitted beside it,
 * because every claim site asked `status === 'running'` and a cancelled job is
 * not running. Nine users were scored twice in thirteen minutes, at double the
 * explanation spend, and `job_runs` recorded one of the two.
 */
describe('decideClaim', () => {
  it('admits a free slot', () => {
    assert.deepEqual(decideClaim(undefined, undefined), { ok: true })
  })

  it('refuses a slot held by a running job', () => {
    assert.deepEqual(decideClaim('job-1', 'running'), { ok: false, cancelling: false })
  })

  it('refuses a slot held by a CANCELLED job, and says so', () => {
    // The regression. A cancelled job holds its slot until the work actually
    // stops; admitting a replacement here is what doubled the bill.
    assert.deepEqual(decideClaim('job-1', 'cancelled'), { ok: false, cancelling: true })
  })

  it('refuses every non-evicted status, terminal or not', () => {
    // A terminal status means the job called completeJob but has not yet
    // reached its finally. Narrow, but the safe answer is still "wait".
    for (const status of ['pending', 'running', 'completed', 'failed', 'cancelled'] as const) {
      assert.equal(decideClaim('job-1', status).ok, false, status)
    }
  })

  it('admits when the holder record has been evicted', () => {
    // progress.ts drops the record five minutes after any terminal status, so
    // an absent record means the holder never released and is not coming back.
    // This is the escape hatch for a hung job, bounded to those five minutes.
    assert.deepEqual(decideClaim('job-1', undefined), { ok: true })
  })

  it('reports cancelling only for cancelled, never for a plain failure', () => {
    const failed = decideClaim('job-1', 'failed')
    assert.equal(failed.ok, false)
    assert.equal(failed.ok === false && failed.cancelling, false)
  })
})

describe('claimJob / releaseJob', () => {
  const NAME = 'test-job'

  beforeEach(() => {
    activeJobs.delete(NAME)
  })

  it('claims a free slot and records the holder', () => {
    assert.deepEqual(claimJob(NAME, 'job-a'), { ok: true })
    assert.equal(activeJobs.get(NAME), 'job-a')
  })

  it('refuses a second claim while the holder is running', () => {
    createJobProgress('job-a', NAME, 1)
    claimJob(NAME, 'job-a')

    const second = claimJob(NAME, 'job-b')
    assert.equal(second.ok, false)
    assert.equal(second.ok === false && second.jobId, 'job-a')
    // The loser must not have overwritten the holder.
    assert.equal(activeJobs.get(NAME), 'job-a')
  })

  it('releases a slot it still owns', () => {
    claimJob(NAME, 'job-a')
    releaseJob(NAME, 'job-a')
    assert.equal(activeJobs.get(NAME), undefined)
  })

  it('does NOT release a slot another run has since claimed', () => {
    // A cancelled-but-still-running job exits after its replacement has taken
    // the name. An unconditional delete here would open the guard on a live
    // run and let a third start beside it.
    activeJobs.set(NAME, 'job-b')
    releaseJob(NAME, 'job-a')
    assert.equal(activeJobs.get(NAME), 'job-b')
  })

  it('is a no-op on an empty slot', () => {
    releaseJob(NAME, 'job-a')
    assert.equal(activeJobs.get(NAME), undefined)
  })
})
