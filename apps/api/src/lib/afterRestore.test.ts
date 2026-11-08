import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { closeGapRunsUnlessScanning, MIGRATIONS_DIR } from './afterRestore.js'
import { activeJobs } from '../routes/jobs/state.js'

test('a gap scan still holding its slot through a restore keeps its run row', async () => {
  let closed = 0
  const close = async () => {
    closed++
  }
  await closeGapRunsUnlessScanning('test-gap-job', close)
  assert.equal(closed, 1)

  activeJobs.set('test-gap-job', 'job-1')
  await closeGapRunsUnlessScanning('test-gap-job', close)
  activeJobs.delete('test-gap-job')
  assert.equal(closed, 1)
})

test('the restore migrates from the folder that holds the migrations', () => {
  assert.ok(readdirSync(MIGRATIONS_DIR).some((name) => name.startsWith('0002_')))
})
