export {
  writeStrmFilesForUser,
  ensureUserLibrary,
  refreshUserLibrary,
  updateUserLibraryPermissions,
  processStrmForAllUsers,
  // Series STRM exports
  writeSeriesStrmFilesForUser,
  ensureUserSeriesLibrary,
  refreshUserSeriesLibrary,
  updateUserSeriesLibraryPermissions,
  processSeriesStrmForAllUsers,
  // Types for library creation transparency
  type UserLibraryResult,
  type ProcessStrmResult,
} from './StrmWriter.js'

export {
  cleanupUserLibraries,
  reconcileStaleStrmLibraries,
  type StrmLibraryMediaType,
} from './cleanup.js'

export {
  isLegacyLibraryOutputEnabled,
  setLegacyLibraryOutputEnabled,
  assertLegacyLibraryOutputEnabled,
  skipIfLegacyLibraryOutputOff,
  countGeneratedLibraries,
  removeGeneratedLibraries,
  LegacyLibraryOutputDisabledError,
  LibraryNameTakenError,
  LEGACY_LIBRARY_OUTPUT_OFF_MESSAGE,
  type GeneratedLibraryCounts,
  type RemoveGeneratedLibrariesResult,
} from './legacyOutput.js'

export {
  LEGACY_LIBRARY_JOBS,
  REMOVE_LEGACY_LIBRARIES_JOB,
  legacyJobBlockedReason,
  type LegacyJobBlockedReason,
} from './legacyOutputRules.js'

