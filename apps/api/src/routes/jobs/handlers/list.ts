/**
 * Jobs List Handlers
 */

import type { FastifyInstance } from 'fastify'
import {
  getJobProgress,
  getAllJobConfigs,
  getJobConfig,
  formatSchedule,
  getLastJobRuns,
  isLegacyLibraryOutputEnabled,
  legacyJobBlockedReason,
  getLastCompletedRunStarts,
  nextScheduledRun,
  schedulerTimeZone,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'
import { getRegisteredSchedule, isSchedulerReady } from '../../../lib/scheduler.js'
import { jobSchemas } from '../schemas.js'
import { jobDefinitions } from '../definitions.js'
import { activeJobs } from '../state.js'
import { resolveRunLimit } from '../runLimit.js'

export async function registerListHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/jobs
   * List all jobs with their status and schedule config
   */
  fastify.get(
    '/api/jobs',
    { preHandler: requireAdmin, schema: jobSchemas.listJobs },
    async (_request, reply) => {
      // Get all job configs from database
      const jobConfigs = await getAllJobConfigs()
      const configMap = new Map(jobConfigs.map((c) => [c.jobName, c]))

      // Get last runs for all jobs
      const lastRunsMap = await getLastJobRuns()

      // Read once for the whole list. The console greys a card on the decided
      // reason rather than holding its own list of which jobs are legacy.
      const legacyOutputEnabled = await isLegacyLibraryOutputEnabled()
      const now = new Date()
      const timeZone = schedulerTimeZone()

      // The next run is decided here, in the scheduler's zone, from the
      // schedule node-cron is actually running (not the saved row, which a
      // failed refresh can leave unapplied), so the page never works it out.
      // Before the scheduler has started nothing is registered yet, and the
      // saved schedule, which it is about to register, stands in.
      const schedulerReady = isSchedulerReady()
      const registered = new Map(
        jobDefinitions.map((def) => [
          def.name,
          schedulerReady ? getRegisteredSchedule(def.name) : (configMap.get(def.name) ?? null),
        ])
      )
      // The biweekly rule reads the last COMPLETED run, as the scheduler's
      // isScheduledRunDue does: one query for every running biweekly job.
      // Unreadable, it counts as no run, the scheduler's own fail-open.
      const biweekly = [...registered]
        .filter(([, schedule]) => schedule?.scheduleType === 'biweekly')
        .map(([name]) => name)
      const lastCompleted = await getLastCompletedRunStarts(biweekly).catch(
        () => new Map<string, Date>()
      )

      const jobs = await Promise.all(
        jobDefinitions.map(async (def) => {
          const activeJobId = activeJobs.get(def.name)
          const progress = activeJobId ? getJobProgress(activeJobId) : null
          const config = configMap.get(def.name) || (await getJobConfig(def.name))
          const lastRun = lastRunsMap.get(def.name)
          const running = registered.get(def.name)
          const nextRunAt = running
            ? nextScheduledRun(running, {
                now,
                timeZone,
                lastCompletedAt: lastCompleted.get(def.name) ?? null,
              })
            : null

          return {
            ...def,
            // `value` is the cap the next run will use, decided here with the
            // executor's own resolver so the card cannot state a different one.
            runLimit: def.runLimit
              ? { ...def.runLimit, value: resolveRunLimit(def.runLimit, config.maxItemsPerRun) }
              : undefined,
            status: progress?.status === 'running' ? 'running' : 'idle',
            blockedReason: legacyJobBlockedReason(def.name, legacyOutputEnabled),
            currentJobId: activeJobId,
            progress: progress
              ? {
                  overallProgress: progress.overallProgress,
                  currentStep: progress.currentStep,
                  itemsProcessed: progress.itemsProcessed,
                  itemsTotal: progress.itemsTotal,
                  // Waiting for another media-server job's turn: read off the
                  // live record, the same field the card's stream carries.
                  queued: progress.queued === true,
                }
              : null,
            schedule: config
              ? {
                  type: config.scheduleType,
                  hour: config.scheduleHour,
                  minute: config.scheduleMinute,
                  dayOfWeek: config.scheduleDayOfWeek,
                  daysOfWeek: config.scheduleDaysOfWeek,
                  intervalHours: config.scheduleIntervalHours,
                  intervalMinutes: config.scheduleIntervalMinutes,
                  maxItemsPerRun: config.maxItemsPerRun,
                  isEnabled: config.isEnabled,
                  formatted: formatSchedule(config),
                  nextRunAt: nextRunAt?.toISOString() ?? null,
                  timeZone,
                }
              : null,
            lastRun: lastRun
              ? {
                  id: lastRun.id,
                  status: lastRun.status,
                  startedAt: lastRun.started_at,
                  completedAt: lastRun.completed_at,
                  durationMs: lastRun.duration_ms,
                  itemsProcessed: lastRun.items_processed,
                  itemsTotal: lastRun.items_total,
                  errorMessage: lastRun.error_message,
                }
              : null,
          }
        })
      )

      return reply.send({ jobs })
    }
  )

  /**
   * GET /api/jobs/:name
   * Get job details
   */
  fastify.get<{ Params: { name: string } }>(
    '/api/jobs/:name',
    { preHandler: requireAdmin, schema: jobSchemas.getJob },
    async (request, reply) => {
      const { name } = request.params

      const jobDef = jobDefinitions.find((j) => j.name === name)
      if (!jobDef) {
        return reply.status(404).send({ error: 'Job not found' })
      }

      const activeJobId = activeJobs.get(name)
      const progress = activeJobId ? getJobProgress(activeJobId) : null

      return reply.send({
        ...jobDef,
        currentJobId: activeJobId,
        progress,
      })
    }
  )
}
