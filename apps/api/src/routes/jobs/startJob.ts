/**
 * Shared job-start helper.
 *
 * The only in-process way to kick off a job. Callers that used to reach for
 * `fastify.inject('/api/jobs/:name/run')` go through this instead — routing a
 * server-side call back through HTTP meant it had to defeat its own auth
 * middleware to get in, which is what the `x-internal-request` bypass was for.
 */

import { randomUUID } from 'crypto'
import { getJobProgress, createChildLogger } from '@aperture/core'
import { jobDefinitions } from './definitions.js'
import { activeJobs } from './state.js'
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

  const existingJobId = activeJobs.get(name)
  if (existingJobId) {
    const progress = getJobProgress(existingJobId)
    if (progress?.status === 'running') {
      return { ok: false, status: 409, error: 'Job is already running', jobId: existingJobId }
    }
  }

  const jobId = randomUUID()
  activeJobs.set(name, jobId)

  logger.info({ job: name, jobId }, `Starting job: ${name}`)

  runJob(name, jobId).catch((err) => {
    logger.error({ err, job: name, jobId }, 'Job failed')
  })

  return { ok: true, jobId }
}
