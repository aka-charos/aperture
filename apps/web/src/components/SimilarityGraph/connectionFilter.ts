/**
 * Which connection types a similarity graph draws.
 *
 * Pure: the filter itself, pinned by connectionFilter.test.ts. The viewer's
 * choice is kept by connectionFilterStore.ts, so every graph in the app (the
 * Explore page, a title's Similar graph and its fullscreen view) and every
 * legend that toggles it agree.
 */
import type { ConnectionType, GraphData, GraphEdge, GraphNode } from './types'
import { CONNECTION_COLORS } from './types'

/**
 * Every connection type a graph can draw, in legend order. Read off the colour
 * map, which is typed `Record<ConnectionType, …>`, so a new type cannot be
 * drawn without also appearing in every legend (and so being filterable).
 */
export const CONNECTION_TYPES = Object.keys(CONNECTION_COLORS) as readonly ConnectionType[]

/**
 * The type an edge is drawn in: the strongest reason it carries. The reason
 * list it is given is already filtered, so a hidden type never colours a line.
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

function endpointId(end: string | GraphNode): string {
  return typeof end === 'string' ? end : end.id
}

/**
 * The graph with the hidden connection types taken out.
 *
 * An edge keeps only its reasons of a shown type, and goes when none is left,
 * so its colour and its "Connected via" chips both describe what is selected.
 * What stays is what a centre still REACHES over shown lines: a poster, or a
 * whole cluster, cut off from every centre goes with the lines that tied it on,
 * since a group floating free reads as a connection to nothing the graph is
 * about. Centres always stay. Nothing hidden returns `data` itself, so the
 * graph does not re-lay itself out for a filter that changed nothing.
 */
export function filterGraphByConnectionTypes(
  data: GraphData,
  hidden: ReadonlySet<ConnectionType>
): GraphData {
  if (hidden.size === 0) return data

  const shown: GraphEdge[] = []
  const neighbours = new Map<string, string[]>()
  const link = (from: string, to: string) => {
    const list = neighbours.get(from)
    if (list) list.push(to)
    else neighbours.set(from, [to])
  }
  for (const edge of data.edges) {
    const reasons = edge.reasons.filter((reason) => !hidden.has(reason.type))
    if (reasons.length === 0) continue
    const source = endpointId(edge.source)
    const target = endpointId(edge.target)
    // Ids, not node objects: the simulation rewrites an edge's ends in place,
    // and a fresh copy keeps the caller's data untouched.
    shown.push({ ...edge, source, target, reasons })
    link(source, target)
    link(target, source)
  }

  // Everything a centre reaches, walking shown lines in either direction.
  const reached = new Set(data.nodes.filter((node) => node.isCenter).map((node) => node.id))
  const queue = [...reached]
  while (queue.length > 0) {
    const id = queue.pop() as string
    for (const next of neighbours.get(id) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }

  return {
    nodes: data.nodes.filter((node) => reached.has(node.id)),
    edges: shown.filter((edge) => reached.has(edge.source as string) && reached.has(edge.target as string)),
  }
}

/**
 * Parse a stored list, keeping only types that exist. Anything unreadable, and
 * a list hiding every type (which would draw a graph of bare centres with
 * nothing saying why), reads as nothing hidden.
 */
export function parseHiddenConnectionTypes(raw: string | null): ConnectionType[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const hidden = CONNECTION_TYPES.filter((type) => value.includes(type))
    return hidden.length === CONNECTION_TYPES.length ? [] : hidden
  } catch {
    return []
  }
}
