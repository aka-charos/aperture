/**
 * How many of `count` cards to draw so a grid of `columns` tracks ends on a
 * full row. A list shorter than one row is drawn whole, as is any list while
 * the column count is unknown (0).
 */
export function wholeRowCount(count: number, columns: number): number {
  if (!(columns > 0) || count <= columns) return count
  return count - (count % columns)
}

/**
 * The number of tracks in a laid-out grid's `grid-template-columns`, as
 * `getComputedStyle` resolves it ("140px 140px 140px"). Anything else, such as
 * the declared `repeat(…)` a grid that is not displayed reports, is 0: unknown.
 */
export function trackCount(template: string): number {
  const tracks = template.trim().split(/\s+/)
  return tracks.every((track) => /^\d+(\.\d+)?px$/.test(track)) ? tracks.length : 0
}
