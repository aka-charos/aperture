/**
 * Receiving a backup file, for both upload routes.
 *
 * Over its limit, the multipart stream does not fail: it just ends early, and only
 * `file.truncated` says so. Taking that for a finished upload saved a cut-off file
 * and reported success, and a cut-off `.sql` is the one thing a restore must never
 * be given. So the file arrives under a temporary name (`writeBackupUpload`) and
 * takes its real name only once it is known to be whole.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  BackupUploadTooLargeError,
  backupUploadTooLargeMessage,
  formatBytes,
  uploadedBackupFilename,
  UPLOAD_TYPE_ERROR,
  writeBackupUpload,
} from '@aperture/core'

export interface BackupUploadOptions {
  backupRoot: string
  maxBytes: number
  validate: (filename: string) => Promise<{ valid: boolean; error?: string }>
}

export async function storeBackupUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  { backupRoot, maxBytes, validate }: BackupUploadOptions
): Promise<FastifyReply> {
  const data = await request.file({ limits: { fileSize: maxBytes } })
  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' })
  }

  const filename = uploadedBackupFilename(data.filename || 'uploaded_backup.sql.gz', new Date())
  if (!filename) {
    data.file.resume()
    return reply.status(400).send({ error: UPLOAD_TYPE_ERROR })
  }

  const filePath = path.join(backupRoot, filename)
  await fs.promises.mkdir(backupRoot, { recursive: true })

  try {
    await writeBackupUpload(data.file, filePath)
  } catch (err) {
    if (err instanceof BackupUploadTooLargeError) {
      return reply.status(413).send({ error: backupUploadTooLargeMessage(maxBytes) })
    }
    throw err
  }

  const stats = await fs.promises.stat(filePath)

  const validation = await validate(filename)
  if (!validation.valid) {
    await fs.promises.unlink(filePath)
    return reply.status(400).send({
      error: `Invalid backup file: ${validation.error}`,
    })
  }

  return reply.send({
    success: true,
    filename,
    sizeBytes: stats.size,
    sizeFormatted: formatBytes(stats.size),
    message: 'Backup file uploaded successfully',
  })
}
