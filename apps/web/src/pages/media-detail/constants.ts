/**
 * Neighbor count for similar-media list and compact graph (depth=1).
 * The graph UI also shows the center title as a node, so visible count is 1 + this value.
 * A multiple of three: the list lays out three per row, so it ends on a full row.
 */
export const DEFAULT_SIMILAR_MEDIA_LIMIT = 9

/** Neighbor cap for fullscreen similarity graph (depth=3 spider view). */
export const FULLSCREEN_SIMILAR_GRAPH_LIMIT = 12
