/**
 * Shared job-start helper.
 *
 * The only in-process way to kick off a job. Callers that used to reach for
 * `fastify.inject('/api/jobs/:name/run')` go through this instead — routing a
 * server-side call back through HTTP meant it had to defeat its own auth
 * middleware to get in, which is what the `x-internal-request` bypass was for.
 */

import { randomUUID } from 'crypto'
import { createChildLogger } from '@aperture/core'
import { jobDefinitions } from './definitions.js'
import { claimJob } from './state.js'
import { runJob } from './executor.js'

const logger = createChildLogger('jobs-start')

export type StartJobResult =
  | { ok: true; jobId: string }
  | { ok: false; status: 404 | 409; error: string; jobId?: string }

/**
 * Register a job as active and run it in the background.
 *
 * Does not await completion — the caller gets a job id to poll for progress.
 * Callers are responsible for their own authorization.
 */
export function startJob(name: string): StartJobResult {
  const jobDef = jobDefinitions.find((j) => j.name === name)
  if (!jobDef) {
    return { ok: false, status: 404, error: 'Job not found' }
  }

  const jobId = randomUUID()
  const claim = claimJob(name, jobId)
  if (!claim.ok) {
    return {
      ok: false,
      status: 409,
      // A cancelled job holds its slot until the work actually stops, so the
      // operator needs to be told the difference between "still going" and
      // "you already stopped this, it is finishing the title it is on".
      error: claim.cancelling
        ? 'Job was cancelled and is still winding down'
        : 'Job is already running',
      jobId: claim.jobId,
    }
  }

  logger.info({ job: name, jobId }, `Starting job: ${name}`)

  runJob(name, jobId).catch((err) => {
    logger.error({ err, job: name, jobId }, 'Job failed')
  })

  return { ok: true, jobId }
}
