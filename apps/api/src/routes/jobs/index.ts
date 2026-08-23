/**
 * Jobs Routes
 *
 * Background job management endpoints.
 * All endpoints require admin authentication.
 */

import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import {
  createChildLogger,
} from '@aperture/core'
import { setJobExecutor } from '../../lib/scheduler.js'
import { jobDefinitions } from './definitions.js'
import { claimJob, releaseJob } from './state.js'
import { runJob } from './executor.js'
import {
  registerListHandlers,
  registerRunHandlers,
  registerConfigHandlers,
  registerProgressHandlers,
  registerHistoryHandlers,
  registerSchedulerHandlers,
  registerEnrichmentHandlers,
  registerPurgeHandlers,
} from './handlers/index.js'
import { jobComponentSchemas } from './schemas.js'

const logger = createChildLogger('jobs-api')

const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  // Register component schemas for $ref usage
  for (const [name, schema] of Object.entries(jobComponentSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }
  
  // Set up the job executor for the scheduler
  setJobExecutor(async (jobName: string) => {
    const jobDef = jobDefinitions.find((j) => j.name === jobName)
    if (!jobDef) {
      throw new Error(`Unknown job: ${jobName}`)
    }

    const jobId = randomUUID()
    const claim = claimJob(jobName, jobId)
    if (!claim.ok) {
      logger.info(
        { job: jobName, holder: claim.jobId, cancelling: claim.cancelling },
        'Job still in flight, skipping scheduled run'
      )
      return
    }

    try {
      // The one scheduled entry point. Every other caller of runJob (the Run
      // button via startJob, the setup wizard, gap analysis) is a person asking
      // for work and takes the 'manual' default.
      await runJob(jobName, jobId, 'scheduled')
    } finally {
      releaseJob(jobName, jobId)
    }
  })

  // Register all handler groups
  await registerListHandlers(fastify)
  await registerRunHandlers(fastify)
  await registerConfigHandlers(fastify)
  await registerProgressHandlers(fastify)
  await registerHistoryHandlers(fastify)
  await registerSchedulerHandlers(fastify)
  await registerEnrichmentHandlers(fastify)
  await registerPurgeHandlers(fastify)
}

export default jobsRoutes
