/**
 * Legacy library output: the decisions, with no DB and no media server, so a
 * test can pin them without pulling in the core barrel's pool.
 *
 * "Legacy library output" is how recommendations reached the media server
 * before Emby home rows: a virtual library per viewer (AI Picks, one for movies
 * and one for series) plus two shared Top Picks libraries, each a folder of
 * STRM files or symlinks under /aperture-libraries, and the Top Picks
 * collections and playlists, which are built from the Top Picks library's OWN
 * items and therefore cannot exist without it. Home rows (homeSections/) tag
 * the original items instead, so they need no files, no mount and no second
 * copy of anything.
 *
 * The switch is the interim step of phasing that out. Off means nothing is
 * written or created any more — and nothing that already exists is touched:
 * removing it is a separate, explicit job (`remove-legacy-libraries`), because
 * switching a setting off is something an operator tries, and deleting every
 * viewer's library as a side effect of trying it is not.
 */

import { extractProviderUserIdFromFolderName } from './filenames.js'

/** The `system_settings` key. */
export const LEGACY_LIBRARY_OUTPUT_SETTING = 'legacy_library_output_enabled'

/**
 * Absent means ON. Every instance before the switch existed wrote libraries,
 * and an absent setting must keep doing what it did — only an explicit
 * `'false'` turns the output off.
 */
export function parseLegacyLibraryOutputSetting(value: string | null | undefined): boolean {
  return value !== 'false'
}

/**
 * Jobs whose only product is legacy output. `refresh-top-picks` belongs here:
 * the Top Picks pages and the Top Picks home rows compute their lists live
 * (`getTopMovies`/`getTopSeries`), so the job's work is the libraries and the
 * collections and playlists built from them — nothing else reads it.
 */
export const LEGACY_LIBRARY_JOBS = [
  'sync-movie-libraries',
  'sync-series-libraries',
  'refresh-top-picks',
] as const

/** The job that removes what the legacy jobs made. */
export const REMOVE_LEGACY_LIBRARIES_JOB = 'remove-legacy-libraries'

/**
 * Why a job cannot usefully run right now. Shipped to the Jobs console as a
 * decided value, so the bundle never holds the list above.
 */
export type LegacyJobBlockedReason = 'legacyLibraryOutputOff' | 'legacyLibraryOutputOn'

export function legacyJobBlockedReason(
  jobName: string,
  legacyEnabled: boolean
): LegacyJobBlockedReason | null {
  if (!legacyEnabled && (LEGACY_LIBRARY_JOBS as readonly string[]).includes(jobName)) {
    return 'legacyLibraryOutputOff'
  }
  // Removing while the output is on would be undone by the next library sync,
  // which runs every few hours — so it is refused rather than offered.
  if (legacyEnabled && jobName === REMOVE_LEGACY_LIBRARIES_JOB) {
    return 'legacyLibraryOutputOn'
  }
  return null
}

/** One `strm_libraries` row, as the removal needs it. */
export interface GeneratedLibraryRow {
  id: string
  userId: string | null
  channelId: string | null
  name: string
  mediaType: string
  providerLibraryId: string | null
}

/** A library the media server reports, as the removal needs it. */
export interface ServerLibraryRef {
  id: string
  name: string
  /** The folders it reads, as the media server sees them. Absent when the server did not say. */
  locations?: readonly string[]
}

export interface GeneratedLibraryDeletion {
  serverName: string
  /** Rows pointing at it — empty for an orphan. */
  rowIds: string[]
  /**
   * No row points at it: it was found by where it reads from. Every library
   * whose title template was renamed is one of these, because the old row is
   * dropped when the new name is written and the old library was never deleted.
   */
  orphan: boolean
  /** Its folders under the libraries root, as segments (`generatedLocationSegments`). */
  folders: string[][]
}

export interface GeneratedLibraryRemovalPlan {
  /**
   * One entry per media-server library to delete, with every row that points
   * at it. The delete is by NAME (that is what `/Library/VirtualFolders` takes),
   * so two rows naming one library must become one delete, not two — the
   * second would fail on a library the first already removed.
   */
  deletions: GeneratedLibraryDeletion[]
  /** Rows whose library is no longer on the server: only the row is left to clear. */
  alreadyGone: string[]
  /**
   * Libraries a row points at that read folders legacy output never writes.
   * Not deleted: `createVirtualLibrary` ADOPTS an existing library with the
   * requested name, so a Top Picks library named like one of the operator's own
   * has a row pointing at the operator's library. Their rows are kept, which is
   * the state they were already in.
   */
  refused: Array<{ serverName: string; rowIds: string[]; locations: string[] }>
}

/** The folders under the libraries root that legacy output writes, and no others. */
export const OUTPUT_SUBFOLDERS = [
  'aperture',
  'aperture-tv',
  'top-picks-movies',
  'top-picks-series',
  'channels',
] as const

/** Subfolders holding one folder per viewer or channel; the rest ARE the library's folder. */
const PER_ENTRY_SUBFOLDERS: ReadonlySet<string> = new Set(['aperture', 'aperture-tv', 'channels'])

function normalizeLocation(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
}

/**
 * Where a library location sits under the libraries root (the media server's
 * view of `/aperture-libraries`, the File locations setting), as path segments
 * — or null when it is not a folder legacy output writes.
 *
 * Deliberately narrow, because a match is grounds for deleting a library from
 * the media server: the location must be exactly one of the shapes the writers
 * create — `aperture/<viewer>`, `aperture-tv/<viewer>`, `channels/<id>`, or
 * `top-picks-movies`/`top-picks-series` itself — so even a root set far too
 * wide (`/mnt/`) cannot claim the operator's own `/mnt/Movies`. A root of `/`
 * or nothing matches nothing. Windows paths compare without case, the way that
 * file system does, and backslashes are read as separators.
 */
export function generatedLocationSegments(location: string, libraryPathPrefix: string): string[] | null {
  const prefix = normalizeLocation(libraryPathPrefix.trim())
  if (!prefix || prefix === '/') return null
  const loc = normalizeLocation(location.trim())

  // A drive letter or a backslash anywhere means a Windows media server.
  const caseless = /^[A-Za-z]:(\/|$)/.test(prefix) || libraryPathPrefix.includes('\\')
  const fold = (value: string) => (caseless ? value.toLowerCase() : value)
  if (!fold(loc).startsWith(fold(prefix) + '/')) return null

  const segments = loc.slice(prefix.length + 1).split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) return null

  const first = fold(segments[0])
  if (!(OUTPUT_SUBFOLDERS as readonly string[]).includes(first)) return null
  const expected = PER_ENTRY_SUBFOLDERS.has(first) ? 2 : 1
  if (segments.length !== expected) return null

  return [first, ...segments.slice(1)]
}

/** A library every one of whose folders legacy output writes — and at least one. */
function generatedFolders(library: ServerLibraryRef, libraryPathPrefix: string): string[][] | null {
  const locations = library.locations ?? []
  if (locations.length === 0) return null
  const folders: string[][] = []
  for (const location of locations) {
    const segments = generatedLocationSegments(location, libraryPathPrefix)
    if (!segments) return null
    folders.push(segments)
  }
  return folders
}

/**
 * Which server library each row refers to. The stored id wins, because it came
 * from the server when the library was made; the name is the fallback for rows
 * written before ids were stored, or for a library recreated by hand under the
 * same generated name.
 *
 * A row matching nothing is reported as already gone — never guessed at. The
 * caller clears that row, which is safe only because the server has no library
 * it could stop excluding from sync.
 *
 * A server library no row points at is an ORPHAN and is deleted only when every
 * folder it reads is one legacy output writes (`generatedLocationSegments`) —
 * never on its name, which an operator can type too. Without a
 * `libraryPathPrefix` no orphan is looked for at all.
 */
export function planGeneratedLibraryRemoval(
  rows: readonly GeneratedLibraryRow[],
  serverLibraries: readonly ServerLibraryRef[],
  libraryPathPrefix = ''
): GeneratedLibraryRemovalPlan {
  const byId = new Map(serverLibraries.map((lib) => [lib.id, lib]))
  const byName = new Map(serverLibraries.map((lib) => [lib.name, lib]))

  const deletions = new Map<string, GeneratedLibraryDeletion>()
  const refused = new Map<string, { serverName: string; rowIds: string[]; locations: string[] }>()
  const alreadyGone: string[] = []

  for (const row of rows) {
    const match =
      (row.providerLibraryId ? byId.get(row.providerLibraryId) : undefined) ?? byName.get(row.name)
    if (!match) {
      alreadyGone.push(row.id)
      continue
    }
    // A library that says where it reads, and reads anywhere legacy output does
    // not write, is not ours however its row came to point at it. Checked only
    // against a known root, and only when the server reported locations.
    const locations = match.locations ?? []
    if (libraryPathPrefix && locations.length > 0 && !generatedFolders(match, libraryPathPrefix)) {
      const kept = refused.get(match.name) ?? { serverName: match.name, rowIds: [], locations: [...locations] }
      kept.rowIds.push(row.id)
      refused.set(match.name, kept)
      continue
    }
    const entry = deletions.get(match.name) ?? {
      serverName: match.name,
      rowIds: [],
      orphan: false,
      folders: generatedFolders(match, libraryPathPrefix) ?? [],
    }
    entry.rowIds.push(row.id)
    deletions.set(match.name, entry)
  }

  for (const library of serverLibraries) {
    if (deletions.has(library.name) || refused.has(library.name)) continue
    const folders = generatedFolders(library, libraryPathPrefix)
    if (!folders) continue
    deletions.set(library.name, { serverName: library.name, rowIds: [], orphan: true, folders })
  }

  return { deletions: [...deletions.values()], alreadyGone, refused: [...refused.values()] }
}

/** The scope a personal library was written under (`strm_library_scopes`). */
export interface WrittenScope {
  /** Library ids its picks could come from; null when nothing restricted them. */
  libraryIds: readonly string[] | null
  maxParentalRating: number | null
}

/** What the owner may open now: the media server's permission and parental ceiling. */
export interface CurrentAccess {
  /** Library ids the server lets them open; null when it grants every folder. */
  libraryAccess: readonly string[] | null
  maxParentalRating: number | null
}

/**
 * Whether a FROZEN personal library may stay: its owner must still be allowed
 * everything the scope it was written under allowed.
 *
 * A generated library plays the original files, so anything in it is playable
 * whatever the server now hides (F-136). While the output is on the next sync
 * rewrites it from the current scope; while it is off nothing does, so this is
 * the only thing standing between a narrowed permission and the old picks.
 *
 * The failure is asymmetric toward removing: an owner who can open every
 * library at any rating keeps it whatever was recorded, and one who cannot
 * keeps it only when a recorded scope proves it is covered — no record (a
 * library written before the record existed) counts as not proven.
 */
export function frozenLibraryStillPermitted(written: WrittenScope | null, current: CurrentAccess): boolean {
  const accessOpen = current.libraryAccess === null
  const ratingOpen = current.maxParentalRating === null
  if (accessOpen && ratingOpen) return true
  if (!written) return false

  const allowed = new Set(current.libraryAccess ?? [])
  const librariesCovered =
    accessOpen || (written.libraryIds !== null && written.libraryIds.every((id) => allowed.has(id)))
  const ratingCovered =
    ratingOpen ||
    (written.maxParentalRating !== null &&
      current.maxParentalRating !== null &&
      written.maxParentalRating <= current.maxParentalRating)
  return librariesCovered && ratingCovered
}

/**
 * Whether a Top Picks collection or playlist may be deleted: only when every
 * title in it belongs to a Top Picks library — or it holds nothing at all.
 *
 * Both are found by the NAME in the Top Picks settings, and a name is something
 * an operator can give their own collection too; what makes one ours is what it
 * holds, since the writer fills it from the Top Picks library's own items only.
 * That is also why this runs BEFORE the libraries are deleted: afterwards every
 * container is empty and the test can no longer tell ours from theirs — it can
 * only pass an empty one, which is still the right answer for a shell left by
 * an earlier removal.
 */
export function isDisposableTopPicksContainer(
  containerItemIds: readonly string[],
  topPicksItemIds: ReadonlySet<string>
): boolean {
  return containerItemIds.every((id) => topPicksItemIds.has(id))
}

/**
 * The output folder a SHARED row writes to, as segments under the libraries
 * root: Top Picks and pinned channels have fixed folders. Personal rows return
 * null — their folder carries the viewer's display name, which can have changed
 * since it was written, so the caller finds it by the provider id in its name
 * (`personalOutputFolders`) instead of rebuilding a name that may be stale.
 */
export function sharedOutputFolder(row: Pick<GeneratedLibraryRow, 'userId' | 'channelId' | 'mediaType'>): string[] | null {
  if (row.channelId) return ['channels', row.channelId]
  if (row.userId) return null
  return [row.mediaType === 'series' ? 'top-picks-series' : 'top-picks-movies']
}

/** The subfolder a viewer's personal library lives under, by media type. */
export function personalOutputRoot(mediaType: string): 'aperture' | 'aperture-tv' {
  return mediaType === 'series' ? 'aperture-tv' : 'aperture'
}

/**
 * A viewer's folders among a directory listing: `DisplayName_<providerUserId>`,
 * or the bare id from before display names were added. Matched on the id alone,
 * so a folder written under an old display name is still found.
 */
export function personalOutputFolders(entries: readonly string[], providerUserId: string): string[] {
  if (!providerUserId) return []
  return entries.filter((entry) => extractProviderUserIdFromFolderName(entry) === providerUserId)
}
