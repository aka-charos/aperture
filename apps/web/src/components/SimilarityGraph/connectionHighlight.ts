/**
 * Which connections a similarity graph emphasises.
 *
 * A graph's lines are chosen by embedding similarity; their types (director,
 * genre…) are labels for what the two titles happen to share. So the legend
 * HIGHLIGHTS a type rather than removing it: every poster and line stays where
 * the layout put it, the chosen types are drawn strongly and the rest is
 * dimmed. Removing lines instead re-ran the layout without the links holding
 * the clusters together and scattered them across the canvas.
 *
 * Pure, pinned by connectionHighlight.test.ts. The choice itself is kept by
 * connectionHighlightStore.ts, shared by every graph and legend on screen.
 */
import type { ConnectionType, GraphEdge, GraphNode } from './types'
import { CONNECTION_COLORS } from './types'

/**
 * Every connection type a graph can draw, in legend order. Read off the colour
 * map, which is typed `Record<ConnectionType, …>`, so a new type cannot be
 * drawn without also appearing in every legend.
 */
export const CONNECTION_TYPES = Object.keys(CONNECTION_COLORS) as readonly ConnectionType[]

/**
 * The type an edge is drawn in: the strongest reason it carries.
 *
 * Mirrors core's getPrimaryConnectionType (packages/core/src/similarity/
 * reasons.ts); change the two together. `crew` is the one type core never
 * draws: only Next from here's map, which builds its lines in the bundle.
 */
export function primaryConnectionType(reasons: GraphEdge['reasons']): ConnectionType {
  const priority: ConnectionType[] = [
    'ai_diverse',
    'collection',
    'director',
    'crew',
    'actor',
    'network',
    'studio',
    'genre',
    'keyword',
    'similarity',
  ]
  for (const type of priority) {
    if (reasons.some((r) => r.type === type)) return type
  }
  return 'similarity'
}

/**
 * The types a legend lists for one graph, in legend order: every type some
 * edge carries (a highlight lights any edge CARRYING the type, not only the
 * edges drawn in its colour), plus any type still chosen or previewed: either
 * one dims the graph, so a type the new graph lacks must stay listed and
 * undoable rather than dimming it for a reason nobody can see. A previewed
 * entry also has to stay under the pointer, or no pointerleave ever clears it.
 * No graph and no highlight lists nothing.
 */
export function legendConnectionTypes(
  edges: readonly GraphEdge[] | null | undefined,
  highlighted: ReadonlySet<ConnectionType>,
  preview: ConnectionType | null
): ConnectionType[] {
  const present = new Set<ConnectionType>(highlighted)
  if (preview) present.add(preview)
  for (const edge of edges ?? []) {
    present.add(primaryConnectionType(edge.reasons))
    for (const reason of edge.reasons) present.add(reason.type)
  }
  return CONNECTION_TYPES.filter((type) => present.has(type))
}

/**
 * Whether an edge is drawn strongly: nothing is highlighted, or it carries a
 * highlighted type. An edge with no reasons carries the type it is drawn in,
 * since that is the entry the legend lists for it.
 */
export function edgeIsLit(reasons: GraphEdge['reasons'], highlighted: ReadonlySet<ConnectionType>): boolean {
  if (highlighted.size === 0) return true
  if (reasons.length === 0) return highlighted.has(primaryConnectionType(reasons))
  return reasons.some((r) => highlighted.has(r.type))
}

/**
 * The colour an edge is drawn in. While types are highlighted, a lit edge takes
 * the strongest HIGHLIGHTED reason it carries, so a line shared by director and
 * genre reads as genre when only genre was asked for.
 */
export function edgeColorType(
  reasons: GraphEdge['reasons'],
  highlighted: ReadonlySet<ConnectionType>
): ConnectionType {
  if (highlighted.size === 0) return primaryConnectionType(reasons)
  const chosen = reasons.filter((r) => highlighted.has(r.type))
  return primaryConnectionType(chosen.length > 0 ? chosen : reasons)
}

/** The chosen set with one type added or removed; a new set, the input untouched. */
export function toggleHighlight(
  highlighted: ReadonlySet<ConnectionType>,
  type: ConnectionType
): ReadonlySet<ConnectionType> {
  const next = new Set(highlighted)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  return next
}

/**
 * What a graph draws: the hovered legend entry while there is one, else the
 * chosen set. With no preview it returns the chosen set ITSELF, so a graph's
 * restyle effect, keyed on this value, does not re-run while nothing changed.
 */
export function effectiveHighlight(
  highlighted: ReadonlySet<ConnectionType>,
  preview: ConnectionType | null
): ReadonlySet<ConnectionType> {
  return preview ? new Set([preview]) : highlighted
}

function endpointId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}

/**
 * The posters drawn at full strength: every one while nothing is highlighted,
 * otherwise the centres (what the graph is about, kept as a landmark) and every
 * poster a lit edge reaches. Null means "all".
 */
export function litNodeIds(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  highlighted: ReadonlySet<ConnectionType>
): Set<string> | null {
  if (highlighted.size === 0) return null
  const lit = new Set(nodes.filter((node) => node.isCenter).map((node) => node.id))
  for (const edge of edges) {
    if (!edgeIsLit(edge.reasons, highlighted)) continue
    lit.add(endpointId(edge.source))
    lit.add(endpointId(edge.target))
  }
  return lit
}
