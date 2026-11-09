/**
 * Most titles the Related list asks for. The grid fits as many cards per row
 * as its column allows and the list draws only whole rows (`wholeRowCount`),
 * so fewer may show: ten at five a row, seven at seven.
 */
export const DEFAULT_SIMILAR_MEDIA_LIMIT = 12

/**
 * Neighbor count for the compact graph beside the list (depth=1). The graph
 * also draws the center title, so it shows 1 + this value. Its own number: the
 * compact graph has a fixed height, and every edge is checked by the
 * connection validator, which may ask an AI model.
 */
export const COMPACT_SIMILAR_GRAPH_LIMIT = 9

/** Neighbor cap for fullscreen similarity graph (depth=3 spider view). */
export const FULLSCREEN_SIMILAR_GRAPH_LIMIT = 12
