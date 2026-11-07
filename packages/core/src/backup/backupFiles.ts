/**
 * Which files in the backup folder are backups, and which of them retention may
 * delete. Pure, because the listing, the pruning and both upload routes all ask.
 */

const AUTOMATIC_PREFIX = 'aperture_backup_'
const UPLOADED_PREFIX = 'aperture_uploaded_'

const BACKUP_EXTENSIONS = ['.dump', '.sql.gz', '.sql'] as const

function backupExtension(filename: string): string | null {
  return BACKUP_EXTENSIONS.find((ext) => filename.endsWith(ext)) ?? null
}

/** A file the list shows: one this app wrote or one an admin uploaded. Never a `.partial`. */
export function isBackupFile(filename: string): boolean {
  return (
    (filename.startsWith(AUTOMATIC_PREFIX) || filename.startsWith(UPLOADED_PREFIX)) &&
    backupExtension(filename) !== null
  )
}

/**
 * Retention counts only what this app wrote. An upload is the one copy of something
 * an admin brought here on purpose, so it stays until they delete it.
 */
export function retentionMayDelete(filename: string): boolean {
  return filename.startsWith(AUTOMATIC_PREFIX)
}

/** What to save an upload as, or null when its type cannot be restored. */
export function uploadedBackupFilename(originalName: string, now: Date): string | null {
  const ext = backupExtension(originalName)
  if (!ext) return null
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return `${UPLOADED_PREFIX}${timestamp}${ext}`
}

/**
 * Uploads used to be cut at this size with no error, and stayed hidden in the folder.
 * The list shows them now, so one this exact size is taken to be cut off and is not
 * offered for restore. A whole file of exactly this size would have to be uploaded
 * again under a different size, which is the price of telling them apart afterwards.
 */
const OLD_UPLOAD_CEILING_BYTES = 10 * 1024 * 1024

export function wasCutOffAtUpload(filename: string, sizeBytes: number): boolean {
  return filename.startsWith(UPLOADED_PREFIX) && sizeBytes === OLD_UPLOAD_CEILING_BYTES
}

/** Only here to stop a runaway upload filling the disk: a real backup can be many gigabytes. */
export const BACKUP_UPLOAD_MAX_BYTES = 50 * 1024 ** 3

export function backupUploadTooLargeMessage(maxBytes: number): string {
  const gigabytes = Math.round((maxBytes / 1024 ** 3) * 100) / 100
  return `The file is larger than the ${gigabytes} GB upload limit, so it was not kept. Copy it into the backup folder directly.`
}

export const UPLOAD_TYPE_ERROR = 'Invalid file type. Only .dump, .sql and .sql.gz files are allowed'
