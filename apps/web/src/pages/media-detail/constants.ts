/**
 * Neighbor count for similar-media list and compact graph (depth=1).
 * The graph UI also shows the center title as a node, so visible count is 1 + this value.
 * Divisible by three, four and six, the usual cards per row, so the list ends on a full row.
 */
export const DEFAULT_SIMILAR_MEDIA_LIMIT = 12

/** Neighbor cap for fullscreen similarity graph (depth=3 spider view). */
export const FULLSCREEN_SIMILAR_GRAPH_LIMIT = 12
