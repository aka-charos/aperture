/**
 * Next from here as a map: the start in the middle, its suggestions and the
 * first unseen titles of each of its people around it, drawn by the
 * similarity graph (components/SimilarityGraph). A line from the start says
 * why that title is there — the person, franchise or theme it shares, or only
 * closeness in feel — and a line between two others says what they share with
 * each other (the API's `map.links`), so a director's films sit together.
 *
 * Pure, pinned by next.test.ts. Every line is a NAMED reason; the graph's
 * own "N% similar" heading is replaced by a caption, since nothing here is a
 * percentage.
 */

import type { ConnectionReason, ConnectionType, GraphData, GraphEdge, GraphNode } from '@/components/SimilarityGraph/types'
import type { TrailEntity, TrailRole, TrailTitle } from '../trails/types'
import type { NextFromHereResponse } from './types'

/** The connection type a credit is drawn in. */
export function connectionTypeFor(entity: Pick<TrailEntity, 'kind'>, roles: readonly TrailRole[]): ConnectionType {
  switch (entity.kind) {
    case 'franchise':
      return 'collection'
    case 'keyword':
      return 'keyword'
    case 'company':
      return roles.includes('network') ? 'network' : 'studio'
    case 'person':
      if (roles.includes('director') || roles.includes('creator')) return 'director'
      if (roles.some((role) => role === 'writer' || role === 'cinematographer' || role === 'composer' || role === 'editor')) {
        return 'crew'
      }
      return 'actor'
  }
}

export interface MapLabels {
  /** "#2 closest film", for a line that is closeness in feel. */
  closeness: (rank: number, type: 'movie' | 'series') => string
  /** A credit as a line's caption: "Brad Anderson · Director". */
  via: (entity: TrailEntity, roles: readonly TrailRole[]) => string
  /** The themes a line carries: "Themes: asylum, abandoned building". */
  themes: (names: readonly string[]) => string
}

/**
 * How long a line wants to be, in the graph's own 0–1 "similarity" (it sets
 * link length and pull only; the caption replaces the percentage). Closest in
 * feel pull hardest; a person shared pulls their titles together.
 */
const PULL = { feelBest: 0.9, feelStep: 0.04, feelFloor: 0.45, person: 0.55, theme: 0.35, between: 0.6 } as const

function node(title: TrailTitle, isCenter: boolean): GraphNode {
  return { id: title.id, title: title.title, year: title.year, poster_url: title.posterUrl, type: title.type, isCenter }
}

function addReason(reasons: ConnectionReason[], reason: ConnectionReason) {
  if (!reasons.some((r) => r.type === reason.type && r.value === reason.value)) reasons.push(reason)
}

export function buildMapData(data: NextFromHereResponse, labels: MapLabels): GraphData | null {
  const start = data.start
  if (!start) return null
  const titles = new Map<string, TrailTitle>()
  for (const item of data.close) titles.set(item.title.ref, item.title)
  for (const row of data.people) for (const member of row.members) titles.set(member.title.ref, member.title)

  const nodes: GraphNode[] = [node(start, true)]
  const edges: GraphEdge[] = []
  const drawn = new Set<string>()
  const close = new Map(data.close.map((item) => [item.title.ref, item]))

  for (const ref of data.map.refs) {
    const title = titles.get(ref)
    if (!title || ref === start.ref || drawn.has(ref)) continue
    drawn.add(ref)
    nodes.push(node(title, false))

    const reasons: ConnectionReason[] = []
    let similarity = 0
    let viaCaption: string | null = null
    let feelCaption: string | null = null
    const item = close.get(ref)
    for (const reason of item?.reasons ?? []) {
      if (reason.kind === 'shared') {
        addReason(reasons, { type: connectionTypeFor(reason.entity, reason.rolesHere), value: reason.entity.name })
        similarity = Math.max(similarity, PULL.person)
        viaCaption ??= labels.via(reason.entity, reason.rolesHere)
      } else if (reason.kind === 'themes') {
        for (const theme of reason.entities) addReason(reasons, { type: 'keyword', value: theme.name })
        similarity = Math.max(similarity, PULL.theme)
      } else if (reason.kind === 'feel') {
        addReason(reasons, { type: 'similarity' })
        similarity = Math.max(similarity, Math.max(PULL.feelFloor, PULL.feelBest - PULL.feelStep * (reason.rank - 1)))
        feelCaption = labels.closeness(reason.rank, title.type)
      }
    }
    // A title drawn for a row: the row's person (or franchise, or company) is its line.
    for (const row of data.people) {
      const member = row.members.find((m) => m.title.ref === ref)
      if (!member) continue
      addReason(reasons, { type: connectionTypeFor(row.entity, row.rolesThere), value: row.entity.name })
      similarity = Math.max(similarity, PULL.person)
      viaCaption ??= labels.via(row.entity, member.roles)
    }
    if (reasons.length === 0) continue
    // A named person says more than a rank, and a rank more than themes alone.
    const caption =
      viaCaption ??
      feelCaption ??
      labels.themes(reasons.filter((r) => r.type === 'keyword').map((r) => r.value ?? ''))
    edges.push({ source: start.id, target: title.id, similarity, reasons, caption })
  }

  for (const link of data.map.links) {
    if (!drawn.has(link.from) || !drawn.has(link.to)) continue
    const from = titles.get(link.from)
    const to = titles.get(link.to)
    if (!from || !to) continue
    const type = connectionTypeFor(link.entity, link.rolesTo.length > 0 ? link.rolesTo : link.rolesFrom)
    edges.push({
      source: from.id,
      target: to.id,
      similarity: type === 'keyword' ? PULL.theme : PULL.between,
      reasons: [{ type, value: link.entity.name }],
      caption: type === 'keyword' ? labels.themes([link.entity.name]) : labels.via(link.entity, link.rolesTo),
    })
  }

  return { nodes, edges }
}
