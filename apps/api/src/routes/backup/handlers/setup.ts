/**
 * Backup Setup Wizard Handlers
 *
 * No session exists yet, so these are fenced by hand: this plugin is not the setup
 * plugin, and that plugin's hook does not reach here.
 */

import type { FastifyInstance } from 'fastify'
import {
  getBackupConfig,
  restoreBackup,
  listBackups,
  validateBackup,
  formatBytes,
  isRestoreInProgress,
  BACKUP_UPLOAD_MAX_BYTES,
} from '@aperture/core'
import { backupSchemas } from '../schemas.js'
import { setupFenceClosingOnComplete } from '../../setup/fence.js'
import { afterDatabaseRestored } from '../../../lib/afterRestore.js'
import { createJobProgressToken } from '../../../lib/jobProgressToken.js'
import { storeBackupUpload } from './upload.js'
import { randomUUID } from 'crypto'

export async function registerSetupHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/setup/backup/list
   * List available backups during setup (no auth required)
   */
  fastify.get(
    '/api/setup/backup/list',
    { schema: backupSchemas.setupListBackups, onRequest: setupFenceClosingOnComplete },
    async (_request, reply) => {
      try {
        const backups = await listBackups()

        return reply.send({
          backups: backups.map((b) => ({
            filename: b.filename,
            sizeBytes: b.sizeBytes,
            sizeFormatted: formatBytes(b.sizeBytes),
            createdAt: b.createdAt,
            isCompressed: b.isCompressed,
            cutOff: b.cutOff,
          })),
          hasBackups: backups.length > 0,
          totalCount: backups.length,
        })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list backups for setup')
        return reply.status(500).send({ error: 'Failed to list backups' })
      }
    }
  )

  /**
   * POST /api/setup/backup/upload
   * Upload a backup file during setup (no auth required)
   */
  fastify.post(
    '/api/setup/backup/upload',
    { schema: backupSchemas.setupUploadBackup, onRequest: setupFenceClosingOnComplete },
    async (request, reply) => {
      try {
        const config = await getBackupConfig()
        return await storeBackupUpload(request, reply, {
          backupRoot: config.backupPath,
          maxBytes: BACKUP_UPLOAD_MAX_BYTES,
          validate: validateBackup,
        })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to upload backup for setup')
        return reply.status(500).send({ error: 'Failed to upload backup' })
      }
    }
  )

  /**
   * POST /api/setup/backup/restore
   * Restore from a backup during setup (no auth required)
   */
  fastify.post<{
    Body: {
      filename: string
      confirmText?: string
    }
    Querystring: { sync?: string }
  }>(
    '/api/setup/backup/restore',
    { schema: backupSchemas.setupRestoreBackup, onRequest: setupFenceClosingOnComplete },
    async (request, reply) => {
      try {
        const { filename, confirmText } = request.body
        const sync = request.query.sync === 'true'
        const jobId = randomUUID()

        if (confirmText !== 'RESTORE') {
          return reply.status(400).send({
            error: 'Please type RESTORE to confirm the restore operation',
          })
        }

        if (!filename || typeof filename !== 'string') {
          return reply.status(400).send({ error: 'Filename is required' })
        }

        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          return reply.status(400).send({ error: 'Invalid filename' })
        }

        const validation = await validateBackup(filename)
        if (!validation.valid) {
          return reply.status(400).send({ error: validation.error || 'Invalid backup file' })
        }

        // Nothing may wait between this and restoreBackup, which claims the restore
        // before its first await.
        if (isRestoreInProgress()) {
          return reply.status(409).send({ error: 'Another restore is already running' })
        }

        if (sync) {
          // Don't create pre-restore backup during setup (database is likely empty)
          const result = await restoreBackup(filename, false, jobId, { afterRestore: afterDatabaseRestored })

          if (!result.success) {
            return reply.status(500).send({
              error: result.error || 'Restore failed',
              duration: result.duration,
              jobId,
            })
          }

          return reply.send({
            success: true,
            duration: result.duration,
            jobId,
            message: 'Database restored successfully. Setup will continue with restored data.',
          })
        } else {
          // Don't create pre-restore backup during setup (database is likely empty)
          restoreBackup(filename, false, jobId, { afterRestore: afterDatabaseRestored }).catch((err) => {
            fastify.log.error({ err, jobId }, 'Background restore during setup failed')
          })

          return reply.send({
            success: true,
            jobId,
            filename,
            // No session exists during setup, and the restore's outcome is only ever
            // read through this.
            progressToken: createJobProgressToken(jobId),
            message: 'Restore started. Track progress with /api/jobs/progress/:jobId',
          })
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to restore backup during setup')
        return reply.status(500).send({ error: 'Failed to restore backup' })
      }
    }
  )
}
