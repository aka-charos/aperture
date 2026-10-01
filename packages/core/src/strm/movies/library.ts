import path from 'path'
import { createChildLogger } from '../../lib/logger.js'
import { query, queryOne } from '../../lib/db.js'
import { getMediaServerProvider } from '../../media/index.js'
import { getMediaServerApiKey } from '../../settings/systemSettings.js'
import { getConfig } from '../config.js'
import { getEffectiveLibraryTitle } from '../../lib/userSettings.js'
import { syncLibraryTypeImage } from '../../uploads/mediaServerSync.js'
import type { StrmConfig } from '../types.js'
import {
  assertLegacyLibraryOutputEnabled,
  LibraryNameTakenError,
  removeRenamedPersonalLibrary,
} from '../legacyOutput.js'
import { rowOwnsLibrary } from '../legacyOutputRules.js'

const logger = createChildLogger('strm-library')

/**
 * Get the custom library name for a user, or fall back to default template
 */
export async function getUserLibraryName(userId: string, displayName: string, _config: StrmConfig): Promise<string> {
  return getEffectiveLibraryTitle(userId, displayName, 'movies')
}

/**
 * Ensure a user's AI library exists in the media server
 */
export async function ensureUserLibrary(
  userId: string,
  providerUserId: string,
  displayName: string
): Promise<{ libraryId: string; libraryGuid: string; created: boolean; name: string }> {
  // Legacy output switched off: refuse before anything is created or written.
  await assertLegacyLibraryOutputEnabled()
  const config = await getConfig()
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('MEDIA_SERVER_API_KEY is required')
  }

  // Build user folder name (DisplayName_ID format for readability)
  const { getUserFolderName } = await import('../filenames.js')
  const userFolder = getUserFolderName(displayName, providerUserId)

  const libraryName = await getUserLibraryName(userId, displayName, config)
  // Library path includes 'aperture' subfolder for AI movie recommendations
  const libraryPath = path.join(config.libraryPathPrefix, 'aperture', userFolder)

  logger.info({ userId, libraryName, libraryPath }, '📚 Checking library status...')

  // Check if we already have a record of this library in our database. Every
  // query here names media_type: the viewer's series library is a row of the
  // same user with channel_id NULL too, and without it this read could return
  // that row (no ORDER BY) and the rename branch below delete the SERIES
  // library — while every DELETE here wiped the series record as a side effect.
  const dbRecord = await queryOne<{
    provider_library_id: string
    provider_library_guid: string
    name: string 
  }>(
    `SELECT provider_library_id, provider_library_guid, name FROM strm_libraries
     WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
    [userId]
  )

  // A library already carrying this name is used only when it reads this
  // viewer's own folder. The viewer picks the name, and adopting whatever
  // carried it handed them the operator's "Movies" — recorded as theirs, then
  // GRANTED to them by updateUserLibraryPermissions. Checked before the rename
  // below touches anything, so a viewer renaming theirs onto a taken name keeps
  // the library they had.
  const takenBy = (await provider.getLibraries(apiKey)).find((lib) => lib.name === libraryName)
  if (
    takenBy &&
    rowOwnsLibrary({ userId, channelId: null, mediaType: 'movies', ownerProviderUserId: providerUserId }, takenBy) ===
      false
  ) {
    // A record pointing at THAT library adopted it before this check existed,
    // and also hid it from the library list: dropped. A record of the viewer's
    // own library under another name is kept.
    if (dbRecord && (dbRecord.provider_library_id === takenBy.id || dbRecord.name === takenBy.name)) {
      await query(`DELETE FROM strm_libraries WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`, [
        userId,
      ])
    }
    throw new LibraryNameTakenError(libraryName, takenBy.locations)
  }

  // If library name changed, delete the old record so we create a new one
  if (dbRecord && dbRecord.name !== libraryName) {
    logger.info({ userId, oldName: dbRecord.name, newName: libraryName }, 'Library name changed, clearing old record')
    // Remove the library under its old name too, not just its record. Both read
    // the same folder, so the old one would otherwise stay in the media server
    // as a duplicate nothing points at — which is how every rename used to leave
    // an orphan behind (F-142). Only when it reads this viewer's own folder:
    // the record may have adopted someone else's library by name.
    await removeRenamedPersonalLibrary({
      provider,
      apiKey,
      userId,
      providerUserId,
      mediaType: 'movies',
      old: { name: dbRecord.name, providerLibraryId: dbRecord.provider_library_id },
      newName: libraryName,
    })
    await query(
      `DELETE FROM strm_libraries WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
      [userId]
    )
  }

  // ALWAYS check if the library actually exists in the media server
  // (User may have deleted it manually from Emby)
  const libraries = await provider.getLibraries(apiKey)
  const existingLib = libraries.find((lib) => lib.name === libraryName)

  if (existingLib) {
    logger.info({ libraryName, libraryId: existingLib.id }, '📚 Library exists in media server')
    
    // Ensure we have an up-to-date database record
    // Delete any existing record first, then insert fresh
    await query(
      `DELETE FROM strm_libraries WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
      [userId]
    )
    await query(
      `INSERT INTO strm_libraries (user_id, name, path, provider_library_id, provider_library_guid)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, libraryName, libraryPath, existingLib.id, existingLib.guid]
    )

    // Push global library image to this library
    await syncLibraryTypeImage('ai-recs-movies', existingLib.id)

    return { libraryId: existingLib.id, libraryGuid: existingLib.guid!, created: false, name: libraryName }
  }

  // Library doesn't exist in media server - need to create it
  logger.info({ userId, libraryName, libraryPath }, '📚 Creating virtual library in media server...')

  // If we had a stale database record, delete it
  if (dbRecord) {
    logger.info({ userId }, 'Clearing stale database record (library was deleted from media server)')
    await query(
      `DELETE FROM strm_libraries WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
      [userId]
    )
  }

  const result = await provider.createVirtualLibrary(apiKey, libraryName, libraryPath, 'movies')

  // Fetch the library again to get the GUID
  const newLibraries = await provider.getLibraries(apiKey)
  const newLib = newLibraries.find((lib) => lib.name === libraryName)
  const libraryGuid = newLib?.guid || result.libraryId

  // Store the mapping with both ID and GUID
  await query(
    `INSERT INTO strm_libraries (user_id, name, path, provider_library_id, provider_library_guid)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, libraryName, libraryPath, result.libraryId, libraryGuid]
  )

  // Push global library image to this library
  await syncLibraryTypeImage('ai-recs-movies', result.libraryId)

  logger.info({ userId, libraryName, libraryId: result.libraryId, libraryGuid }, '✅ Virtual library created')

  return { libraryId: result.libraryId, libraryGuid, created: true, name: libraryName }
}

/**
 * Refresh a user's AI library in the media server
 * Also hides library items from Continue Watching for all users
 */
export async function refreshUserLibrary(userId: string): Promise<void> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('MEDIA_SERVER_API_KEY is required')
  }

  const library = await queryOne<{ provider_library_id: string }>(
    `SELECT provider_library_id FROM strm_libraries
     WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
    [userId]
  )

  if (!library?.provider_library_id) {
    logger.warn({ userId }, 'No library found to refresh')
    return
  }

  await provider.refreshLibrary(apiKey, library.provider_library_id)
  logger.info({ userId, libraryId: library.provider_library_id }, 'Library refreshed')
}

/**
 * Update user's library access permissions
 * Adds the AI Picks library to the user's existing library access
 */
export async function updateUserLibraryPermissions(
  userId: string,
  providerUserId: string
): Promise<void> {
  const provider = await getMediaServerProvider()
  const apiKey = await getMediaServerApiKey()

  if (!apiKey) {
    throw new Error('MEDIA_SERVER_API_KEY is required')
  }

  // Get user's AI library from our database
  const library = await queryOne<{ provider_library_id: string; provider_library_guid: string }>(
    `SELECT provider_library_id, provider_library_guid FROM strm_libraries
     WHERE user_id = $1 AND channel_id IS NULL AND media_type = 'movies'`,
    [userId]
  )

  if (!library?.provider_library_guid) {
    logger.warn({ userId }, 'No AI library found for user')
    return
  }

  // Get the user's current library access from the media server
  const currentAccess = await provider.getUserLibraryAccess(apiKey, providerUserId)
  
  // If user has access to all folders, no need to modify permissions
  // but still set sort preference
  if (currentAccess.enableAllFolders) {
    logger.debug({ userId }, 'User has access to all folders, skipping permission update')
    // Set sort preference for this library (DateCreated descending)
    if (library.provider_library_id) {
      await provider.setLibrarySortPreference(apiKey, providerUserId, library.provider_library_id)
    }
    return
  }

  // Check if AI library is already in the user's allowed list
  if (currentAccess.enabledFolders.includes(library.provider_library_guid)) {
    logger.debug({ userId }, 'AI library already in user permissions')
    return
  }

  // Add the AI library GUID to the user's existing permissions
  const updatedFolders = [...currentAccess.enabledFolders, library.provider_library_guid]

  await provider.updateUserLibraryAccess(apiKey, providerUserId, updatedFolders)
  logger.info({ userId, libraryGuid: library.provider_library_guid }, 'Added AI library to user permissions')

  // Set sort preference for this library (DateCreated descending)
  if (library.provider_library_id) {
    await provider.setLibrarySortPreference(apiKey, providerUserId, library.provider_library_id)
  }
}

