/**
 * The lines on Next from here's map between titles other than the start.
 * The start's own lines are its suggestions' reasons; these show what the
 * suggestions share with each other: a director's films drawn together, a
 * run of titles on one theme. A pair gets at most one line, the strongest
 * thing it shares — a person in a major role or a franchise before a theme.
 * A person or franchise joins their titles however many there are (the people
 * rows ignore the Trails rarity cap, so the map must too, or a prolific
 * director's films sit apart); a theme only while it still links in the
 * viewer's scope (`view.links`), so a catch-all keyword draws nothing.
 *
 * Pure, pinned by nextFromHere.test.ts.
 */

import type { TrailView } from '../trails/graph.js'
import { MAJOR_MASK, MAX_MAP_LINKS, sharedRoleStrength } from './rules.js'

export interface MapLink {
  a: number
  b: number
  entity: number
  maskA: number
  maskB: number
}

/** A theme counts below any shared person or franchise. */
const THEME_STRENGTH = 0.2

export function mapLinks(view: TrailView, titles: readonly number[]): MapLink[] {
  const { index } = view
  const unique = [...new Set(titles)].filter((title) => view.allowed[title] === 1)
  const credits = unique.map((title) => {
    const out = new Map<number, number>()
    const entities = index.titleEntities[title]
    const masks = index.titleMasks[title]
    for (let i = 0; i < entities.length; i += 1) {
      const kind = index.entities[entities[i]].kind
      const strong = (kind === 'person' || kind === 'franchise') && (masks[i] & MAJOR_MASK) !== 0
      if (strong ? view.count(entities[i]) >= 2 : kind === 'keyword' && view.links(entities[i])) {
        out.set(entities[i], masks[i])
      }
    }
    return out
  })

  const found: Array<MapLink & { strength: number }> = []
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      let best: (MapLink & { strength: number }) | null = null
      for (const [entity, maskA] of credits[i]) {
        const maskB = credits[j].get(entity)
        if (maskB === undefined) continue
        const kind = index.entities[entity].kind
        const strength =
          kind === 'keyword' ? THEME_STRENGTH : Math.min(sharedRoleStrength(maskA), sharedRoleStrength(maskB))
        if (strength <= 0) continue
        if (
          !best ||
          strength > best.strength ||
          (strength === best.strength && view.count(entity) < view.count(best.entity))
        ) {
          best = { a: unique[i], b: unique[j], entity, maskA, maskB, strength }
        }
      }
      if (best) found.push(best)
    }
  }
  // Strongest first, rarer first among equals, then position: the same lines on every load.
  found.sort(
    (x, y) =>
      y.strength - x.strength || view.count(x.entity) - view.count(y.entity) || x.a - y.a || x.b - y.b
  )
  return found.slice(0, MAX_MAP_LINKS).map(({ strength: _strength, ...link }) => link)
}
