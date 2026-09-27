/**
 * How the community strip and its dialog word a PARTIAL list of names — the
 * connections audience, where the server names the viewer and the people they
 * are connected to, and everyone else stays a count.
 *
 * Pure and in its own file so it can be pinned without rendering, and so the
 * component modules export only components. Neither function decides who may
 * be named: that is the server's, and names the client never received cannot
 * be shown by anything here.
 */

/** People behind a counter who are not in the named list. Never negative. */
export function unnamedCount(total: number, named: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(named)) return 0
  return Math.max(0, Math.floor(total) - Math.floor(named))
}

/**
 * The label for one named watcher: "You" for the viewer's own row, the name
 * otherwise. Identity, not a permission — during "view as" the viewer is the
 * assumed account, exactly as it is for the server.
 */
export function watcherLabel(
  watcher: { userId: string; name: string },
  viewerId: string | null | undefined,
  youLabel: string
): string {
  return viewerId != null && watcher.userId === viewerId ? youLabel : watcher.name
}
