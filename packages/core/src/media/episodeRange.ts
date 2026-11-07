/**
 * The last episode number one media-server item covers.
 *
 * A double-length episode kept as one file ("S05E01-E02") is a single item whose
 * `IndexNumber` is 1 and `IndexNumberEnd` is 2, on Emby and Jellyfin alike. Counting
 * the item once reads that season as one episode short. An end that is missing, not
 * a whole number, or not past the start covers nothing beyond the start.
 */
export function episodeNumberEnd(start: number | null | undefined, end: number | null | undefined): number | undefined {
  if (start == null || end == null) return undefined
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined
  return end > start ? end : undefined
}
