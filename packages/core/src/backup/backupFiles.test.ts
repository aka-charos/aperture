import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBackupFile, retentionMayDelete, uploadedBackupFilename, wasCutOffAtUpload } from './backupFiles.js'

test('the list shows what this app wrote and what an admin uploaded', () => {
  assert.equal(isBackupFile('aperture_backup_2026-11-06_02-00-00.dump'), true)
  assert.equal(isBackupFile('aperture_backup_2026-01-01_02-00-00.sql.gz'), true)
  assert.equal(isBackupFile('aperture_uploaded_2026-11-06_10-00-00.sql.gz'), true)
  assert.equal(isBackupFile('aperture_uploaded_2026-11-06_10-00-00.dump'), true)
})

test('a dump still being written, restore scratch and anything else stay out of it', () => {
  assert.equal(isBackupFile('aperture_backup_2026-11-06_02-00-00.dump.partial'), false)
  assert.equal(isBackupFile('.restore-abc'), false)
  assert.equal(isBackupFile('notes.sql'), false)
  assert.equal(isBackupFile('aperture_uploaded_x.txt'), false)
})

test('retention deletes only what this app wrote', () => {
  assert.equal(retentionMayDelete('aperture_backup_2026-11-06_02-00-00.dump'), true)
  assert.equal(retentionMayDelete('aperture_uploaded_2026-11-06_10-00-00.dump'), false)
})

test('every name an upload is saved under is one the list shows', () => {
  const now = new Date('2026-11-06T10:20:30.000Z')
  for (const original of ['mine.dump', 'mine.sql', 'mine.sql.gz', 'aperture_backup_2026-11-01_02-00-00.dump']) {
    const saved = uploadedBackupFilename(original, now)
    assert.ok(saved?.startsWith('aperture_uploaded_2026-11-06_10-20-30'), original)
    assert.equal(isBackupFile(saved!), true, original)
  }
  assert.equal(uploadedBackupFilename('mine.sql.gz', now), 'aperture_uploaded_2026-11-06_10-20-30.sql.gz')
})

test('an upload exactly at the old limit reads as cut off; nothing else does', () => {
  const ceiling = 10 * 1024 * 1024
  assert.equal(wasCutOffAtUpload('aperture_uploaded_x.sql', ceiling), true)
  assert.equal(wasCutOffAtUpload('aperture_uploaded_x.sql', ceiling + 1), false)
  assert.equal(wasCutOffAtUpload('aperture_backup_x.dump', ceiling), false)
})

test('a type that cannot be restored is refused', () => {
  assert.equal(uploadedBackupFilename('mine.zip', new Date()), null)
  assert.equal(uploadedBackupFilename('mine.dump.partial', new Date()), null)
})
