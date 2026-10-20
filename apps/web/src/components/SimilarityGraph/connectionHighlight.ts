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
 * reasons.ts); change the two together.
 */
export function primaryConnectionType(reasons: GraphEdge['reasons']): ConnectionType {
  const priority: ConnectionType[] = [
    'ai_diverse',
    'collection',
    'director',
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

/** Whether an edge is drawn strongly: nothing is highlighted, or it carries a highlighted type. */
export function edgeIsLit(reasons: GraphEdge['reasons'], highlighted: ReadonlySet<ConnectionType>): boolean {
  return highlighted.size === 0 || reasons.some((r) => highlighted.has(r.type))
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
