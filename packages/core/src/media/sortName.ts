/**
 * Shared by the Emby and Jellyfin item-update helpers.
 */

/**
 * Set an item's forced sort name on the DTO about to be posted back to the server.
 * Locks the SortName field (merging with any existing locks) so a later metadata
 * refresh does not overwrite it, unless lockSortName is false.
 */
export function setForcedSortName(
  item: Record<string, unknown>,
  sortName: string,
  lockSortName = true
): void {
  item.ForcedSortName = sortName

  if (!lockSortName) {
    return
  }

  const existingLocked = Array.isArray(item.LockedFields) ? item.LockedFields : []
  if (!existingLocked.includes('SortName')) {
    item.LockedFields = [...existingLocked, 'SortName']
  }
}

/** Matches the 'NN - ' rank prefix a collection puts in front of an item's name. */
const RANK_PREFIX = /^(\d{2,}) - /

/**
 * Undo a rank prefix written by a showcase collection ("03 - Heat"), on the DTO about to be
 * posted back. Only an item whose forced sort name is exactly "NN - <its own name>" is touched,
 * so a sort name the user set is never cleared. Returns false when there is nothing to undo.
 */
export function clearRankSortName(item: Record<string, unknown>): boolean {
  const forced = item.ForcedSortName
  const match = typeof forced === 'string' ? RANK_PREFIX.exec(forced) : null
  if (!match || forced !== `${match[1]} - ${item.Name}`) return false

  delete item.ForcedSortName
  if (Array.isArray(item.LockedFields)) {
    item.LockedFields = item.LockedFields.filter((field) => field !== 'SortName')
  }
  return true
}
