/**
 * Jobs Run Handlers
 */

import type { FastifyInstance } from 'fastify'
import {
  cancelJob as cancelJobCore,
  createChildLogger,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import { jobSchemas } from '../schemas.js'
import { jobDefinitions } from '../definitions.js'
import { activeJobs } from '../state.js'
import { startJob } from '../startJob.js'

const logger = createChildLogger('jobs-run')

export async function registerRunHandlers(fastify: FastifyInstance) {
  /**
   * POST /api/jobs/:name/run
   * Trigger a job to run manually
   */
  fastify.post<{ Params: { name: string } }>(
    '/api/jobs/:name/run',
    { preHandler: requireAdmin, schema: jobSchemas.runJob },
    async (request, reply) => {
      const { name } = request.params

      const started = startJob(name)
      if (!started.ok) {
        return reply.status(started.status).send({
          error: started.error,
          ...(started.jobId ? { jobId: started.jobId } : {}),
        })
      }

      return reply.send({
        message: `Job ${name} started`,
        jobId: started.jobId,
        status: 'running',
      })
    }
  )

  /**
   * POST /api/jobs/:name/cancel
   * Cancel a running job
   */
  fastify.post<{ Params: { name: string } }>(
    '/api/jobs/:name/cancel',
    { preHandler: requireAdmin, schema: jobSchemas.cancelJob },
    async (request, reply) => {
      const { name } = request.params

      const jobDef = jobDefinitions.find((j) => j.name === name)
      if (!jobDef) {
        return reply.status(404).send({ error: 'Job not found' })
      }

      const activeJobId = activeJobs.get(name)
      if (!activeJobId) {
        return reply.status(400).send({ error: 'No active job to cancel' })
      }

      const cancelled = cancelJobCore(activeJobId)
      if (!cancelled) {
        return reply.status(400).send({ error: 'Job is not running or already finished' })
      }

      // Clear the active job reference
      activeJobs.delete(name)

      logger.info({ job: name, jobId: activeJobId }, `Job cancelled: ${name}`)

      return reply.send({
        message: `Job ${name} cancelled`,
        jobId: activeJobId,
        status: 'cancelled',
      })
    }
  )
}
