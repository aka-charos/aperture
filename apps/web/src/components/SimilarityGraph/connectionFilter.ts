/**
 * Which connection types a similarity graph draws.
 *
 * Pure: the filter itself, pinned by connectionFilter.test.ts. The viewer's
 * choice is kept by connectionFilterStore.ts, so every graph in the app (the
 * Explore page, a title's Similar graph and its fullscreen view) and every
 * legend that toggles it agree.
 */
import type { ConnectionType, GraphData, GraphEdge, GraphNode } from './types'

/** Every connection type a graph can draw, in legend order. */
export const CONNECTION_TYPES: readonly ConnectionType[] = [
  'director',
  'actor',
  'collection',
  'genre',
  'keyword',
  'studio',
  'network',
  'similarity',
  'ai_diverse',
]

/**
 * The type an edge is drawn in: the strongest reason it carries. The reason
 * list it is given is already filtered, so a hidden type never colours a line.
 */
export function primaryConnectionType(reasons: GraphEdge['reasons']): ConnectionType {
  const priority: ConnectionType[] = [
    'collection',
    'director',
    'actor',
    'network',
    'studio',
    'genre',
    'keyword',
    'ai_diverse',
    'similarity',
  ]
  for (const type of priority) {
    if (reasons.some((r) => r.type === type)) return type
  }
  return 'similarity'
}

function endpointId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}

/**
 * The graph with the hidden connection types taken out.
 *
 * An edge keeps only its reasons of a shown type, and goes when none is left,
 * so its colour and its "Connected via" chips both describe what is selected.
 * A node goes when no edge is left touching it, since a poster floating free
 * reads as a connection nobody drew; centres always stay, being what the graph
 * is about. Nothing hidden returns `data` itself, so the graph does not re-lay
 * itself out for a filter that changed nothing.
 */
export function filterGraphByConnectionTypes(
  data: GraphData,
  hidden: ReadonlySet<ConnectionType>
): GraphData {
  if (hidden.size === 0) return data

  const edges: GraphEdge[] = []
  const touched = new Set<string>()
  for (const edge of data.edges) {
    const reasons = edge.reasons.filter((reason) => !hidden.has(reason.type))
    if (reasons.length === 0) continue
    const source = endpointId(edge.source)
    const target = endpointId(edge.target)
    // Ids, not node objects: the simulation rewrites an edge's ends in place,
    // and a fresh copy keeps the caller's data untouched.
    edges.push({ ...edge, source, target, reasons })
    touched.add(source)
    touched.add(target)
  }

  return {
    nodes: data.nodes.filter((node) => node.isCenter || touched.has(node.id)),
    edges,
  }
}

/** Parse a stored list, keeping only types that exist. Anything else reads as nothing hidden. */
export function parseHiddenConnectionTypes(raw: string | null): ConnectionType[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return CONNECTION_TYPES.filter((type) => value.includes(type))
  } catch {
    return []
  }
}
