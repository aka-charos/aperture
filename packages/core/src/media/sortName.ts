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
