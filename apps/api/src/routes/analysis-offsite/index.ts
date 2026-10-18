/**
 * Offsite title analysis: prepare a batch of prompts here, run them on another
 * machine, import the answers. The work is all core's (`analysis/offsite.ts`);
 * these routes start it, serve the two files and take the results back.
 *
 * Its own namespace for the bench's reason: `/api/analysis/:mediaType/:id`
 * already owns the shape a static segment would sit beside.
 *
 * ADMIN ONLY. Preparing a batch spends retrieval on up to hundreds of titles,
 * the file holds every prompt, and an import writes rows every user reads.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from '../../plugins/auth.js'
import {
  startOffsiteBatch,
  stopOffsiteBatch,
  listOffsiteBatches,
  getOffsiteBatch,
  exportOffsiteBatch,
  closeOffsiteBatch,
  deleteOffsiteBatch,
  importOffsiteResults,
  OFFSITE_BATCH_DEFAULT_SIZE,
  OFFSITE_BATCH_MAX_SIZE,
  OFFSITE_RESERVATION_DAYS,
  OFFSITE_RUNNER_FILE_NAME,
  OFFSITE_RUNNER_SCRIPT,
  createChildLogger,
} from '@aperture/core'

const logger = createChildLogger('analysis-offsite-routes')

/**
 * A results file is about 6–10k characters per answered title, more when a
 * reasoning model writes its thinking into the reply, so a 500-title batch can
 * run to tens of megabytes. Fastify's default is 1 MiB.
 */
const IMPORT_BODY_LIMIT = 64 * 1024 * 1024

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

const analysisOffsiteRoutes: FastifyPluginAsync = async (fastify) => {
  /** Every recent batch, plus the limits the page offers. */
  fastify.get(
    '/api/analysis-offsite/batches',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (_request, reply) => {
      const batches = await listOffsiteBatches()
      return reply.send({
        batches,
        limits: {
          defaultSize: OFFSITE_BATCH_DEFAULT_SIZE,
          maxSize: OFFSITE_BATCH_MAX_SIZE,
          reservationDays: OFFSITE_RESERVATION_DAYS,
        },
        runnerFileName: OFFSITE_RUNNER_FILE_NAME,
      })
    }
  )

  /** Start preparing a batch. 202: preparing is minutes per title, and the page polls. */
  fastify.post<{ Body: { count?: number; mediaTypes?: Array<'movie' | 'series'> } }>(
    '/api/analysis-offsite/batches',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const { count, mediaTypes } = request.body ?? {}
      if (typeof count !== 'number') {
        return reply.status(400).send({ error: 'count must be a number of titles.' })
      }
      if (!Array.isArray(mediaTypes)) {
        return reply.status(400).send({ error: 'mediaTypes must be a list.' })
      }
      try {
        const batchId = await startOffsiteBatch({
          count,
          mediaTypes,
          userId: request.user?.id ?? null,
        })
        return reply.status(202).send({ batchId })
      } catch (err) {
        // Operator-facing refusals with real sentences (wrong retrieval mode, a
        // batch already preparing, a count out of range), passed through.
        logger.warn({ err }, 'Could not start an offsite batch')
        return reply.status(400).send({ error: message(err, 'Could not start the batch.') })
      }
    }
  )

  fastify.get<{ Params: { batchId: string } }>(
    '/api/analysis-offsite/batches/:batchId',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const batch = await getOffsiteBatch(request.params.batchId)
      if (!batch) return reply.status(404).send({ error: 'No such batch.' })
      return reply.send(batch)
    }
  )

  /**
   * The batch file. A plain GET so the page can link to it: a same-origin link
   * carries the session cookie, and the browser saves it under its own name.
   */
  fastify.get<{ Params: { batchId: string } }>(
    '/api/analysis-offsite/batches/:batchId/download',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const file = await exportOffsiteBatch(request.params.batchId)
      if (!file) return reply.status(404).send({ error: 'No such batch.' })
      return reply
        .header('Content-Type', 'application/x-ndjson; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
        .header('Cache-Control', 'no-store')
        .send(file.body)
    }
  )

  /** Stop preparing after the title in hand; what was prepared is kept. */
  fastify.post<{ Params: { batchId: string } }>(
    '/api/analysis-offsite/batches/:batchId/stop',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const stopped = stopOffsiteBatch(request.params.batchId)
      if (!stopped) return reply.status(409).send({ error: 'That batch is not being prepared.' })
      return reply.status(202).send({ stopping: true })
    }
  )

  /** Release the batch's unanswered titles back to the library job. */
  fastify.post<{ Params: { batchId: string } }>(
    '/api/analysis-offsite/batches/:batchId/close',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      try {
        const closed = await closeOffsiteBatch(request.params.batchId)
        if (!closed) return reply.status(404).send({ error: 'No such batch.' })
        return reply.send({ closed: true })
      } catch (err) {
        return reply.status(409).send({ error: message(err, 'Could not close the batch.') })
      }
    }
  )

  fastify.delete<{ Params: { batchId: string } }>(
    '/api/analysis-offsite/batches/:batchId',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      try {
        const deleted = await deleteOffsiteBatch(request.params.batchId)
        if (!deleted) return reply.status(404).send({ error: 'No such batch.' })
        return reply.send({ deleted: true })
      } catch (err) {
        return reply.status(409).send({ error: message(err, 'Could not delete the batch.') })
      }
    }
  )

  /**
   * Import a results file. Not tied to one batch: every line names its own
   * item by `custom_id`, so a file stitched from several runs imports whole.
   */
  fastify.post<{ Body: { jsonl?: string } }>(
    '/api/analysis-offsite/import',
    { preHandler: requireAdmin, bodyLimit: IMPORT_BODY_LIMIT, schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const jsonl = request.body?.jsonl
      if (typeof jsonl !== 'string' || jsonl.trim() === '') {
        return reply.status(400).send({ error: 'The results file is empty.' })
      }
      const summary = await importOffsiteResults(jsonl)
      return reply.send(summary)
    }
  )

  /** The runner script, for the machine that will run the batch. */
  fastify.get(
    '/api/analysis-offsite/runner',
    { preHandler: requireAdmin, schema: { tags: ['analysis'] } },
    async (_request, reply) => {
      return reply
        .header('Content-Type', 'text/javascript; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${OFFSITE_RUNNER_FILE_NAME}"`)
        .header('Cache-Control', 'no-store')
        .send(OFFSITE_RUNNER_SCRIPT)
    }
  )
}

export default analysisOffsiteRoutes
