/**
 * What a restored database needs from a server that is already running: the steps
 * index.ts and buildServer do at boot, which would otherwise wait for a restart.
 *
 * Migrations come first and may fail the restore's report, since a backup older than
 * this build has no columns the code now reads. The rest each repair one thing, so
 * a failure is logged and the next still runs. Runs while the API is still answering
 * 503 (`afterCommit` in core `backup/restore.ts`), so nothing reads the old schema.
 */

import path from 'path'
import { fileURLToPath } from 'url'
import {
  detectInterruptedEnrichmentRuns,
  forgetOffsiteRecovery,
  recoverInterruptedNewsletterSends,
  closeInterruptedSeriesGapRuns,
  closeInterruptedGapRuns,
  runMigrations,
} from '@aperture/core'
import { getDatabaseUrl, getEnv } from '../config/env.js'
import { refreshQuietPollState } from '../config/logging.js'
import { refreshLogMaskingState } from '../config/logMasking.js'
import { refreshProxyTrust } from '../config/proxyTrust.js'
import { createChildLogger } from './logger.js'
import { refreshAllSchedules } from './scheduler.js'
import { activeJobs } from '../routes/jobs/state.js'

const logger = createChildLogger('after-restore')

/**
 * A restore does not stop a running job, so a scan may hold its slot here, and a row it
 * inserted since the commit is alive. An orphan left beside it is closed by the next
 * scan or boot, and cannot read as a scan meanwhile: reads ask the slot.
 */
export async function closeGapRunsUnlessScanning(jobName: string, close: () => Promise<void>): Promise<void> {
  if (!activeJobs.has(jobName)) await close()
}

/** The same folder index.ts migrates from; `src/lib` and `dist/lib` sit at one depth. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../db/migrations'
)

export async function afterDatabaseRestored(): Promise<void> {
  if (getEnv().RUN_MIGRATIONS_ON_START) {
    const { applied } = await runMigrations(getDatabaseUrl(), MIGRATIONS_DIR)
    logger.info({ applied: applied.length }, 'Brought the restored database up to date')
  } else {
    logger.warn('RUN_MIGRATIONS_ON_START is off: run migrations yourself if this backup is older than this build')
  }

  forgetOffsiteRecovery()

  const repairs: Array<[string, () => Promise<void>]> = [
    ['interrupted enrichment runs', detectInterruptedEnrichmentRuns],
    ['interrupted newsletter sends', recoverInterruptedNewsletterSends],
    [
      'interrupted TV gap scans',
      () => closeGapRunsUnlessScanning('refresh-series-gaps', closeInterruptedSeriesGapRuns),
    ],
    [
      'interrupted movie gap scans',
      () => closeGapRunsUnlessScanning('refresh-library-gaps', closeInterruptedGapRuns),
    ],
    ['job schedules', refreshAllSchedules],
    // Read once into memory by buildServer. Left alone, the trusted proxies in force
    // would be the old database's while the page showed the restored list.
    ['trusted proxies', refreshProxyTrust],
    ['quiet poll logs', refreshQuietPollState],
    ['log masking', refreshLogMaskingState],
  ]
  for (const [name, repair] of repairs) {
    await repair().catch((err) => logger.warn({ err }, `Could not refresh ${name} after the restore`))
  }
}
