/**
 * The people behind a title, one row each: what else its director, writers,
 * leads and crew made (and the rest of its franchise, and a studio or network
 * the viewer favours), in the viewer's library. This is Trails' thread view
 * with Next from here's weighting: rows are ordered by what the viewer's own
 * record says of the person, never by how rare they are, and only roles that
 * shape a title open a row — a bit part or a keyword never does.
 *
 * Pure, pinned by nextFromHere.test.ts.
 */

import type { TrailView } from '../trails/graph.js'
import { roleBit } from '../trails/rules.js'
import { MAJOR_MASK, NETWORK_AFFINITY_SHARE, PEOPLE_ROWS, ROW_MEMBERS, ROW_WEIGHTS, sharedRoleStrength } from './rules.js'
import {
  tasteContext,
  type CompanyAffinity,
  type PersonAffinity,
  type TasteContext,
  type ViewerTitle,
} from './taste.js'

export interface PeopleRowMember {
  title: number
  /** The roles this title gives the row's entity. */
  mask: number
  /** Finished, started or rated: never suggested, shown for context. */
  seen: boolean
}

export interface PeopleRow {
  entity: number
  /** The roles the start gives it. */
  mask: number
  /** Set for a person the viewer keeps coming back to. */
  person: PersonAffinity | null
  /** Set for a studio or network the viewer finishes more of than its share; a company only has a row then. */
  company: CompanyAffinity | null
  /** Unseen first (best suggestion first), then seen, newest first; at most ROW_MEMBERS. */
  members: PeopleRowMember[]
  /** Titles past ROW_MEMBERS. */
  more: number
  /** Of those, the unseen ones: what is left out when the viewer hides what they have seen. */
  moreUnseen: number
  /** Of every title in the row (not only those sent), how many the viewer has seen. */
  seenCount: number
  /** Every title in the row, the start left out. */
  total: number
}

export interface PeopleRowsInput {
  view: TrailView
  start: number
  record: ReadonlyMap<number, ViewerTitle>
  /** Finished, started or rated by the viewer. */
  seen: (title: number) => boolean
  /** How good a suggestion each scored title is (taste.ts `scoreCandidates`); absent means unscored. */
  scores: ReadonlyMap<number, number>
  /**
   * Titles left out of every row: the earlier steps of the viewer's trail,
   * which the page promises never to suggest again.
   */
  exclude?: (title: number) => boolean
  /** The request's shared affinities; built here when absent. */
  context?: TasteContext
}

const COMPANY_MASK = roleBit('studio') | roleBit('network')

/** Role strength for a row; a company has none (it is there for the viewer's record alone). */
function rowRoleStrength(kind: string, mask: number): number {
  return kind === 'company' ? 0 : sharedRoleStrength(mask)
}

export function peopleRows(input: PeopleRowsInput): PeopleRow[] {
  const { view, start, record, seen, scores } = input
  const exclude = input.exclude ?? (() => false)
  const context = input.context ?? tasteContext(view, record)
  const startType = view.index.titles[start].type
  const entities = view.index.titleEntities[start]
  const masks = view.index.titleMasks[start]
  const rows: Array<PeopleRow & { order: number }> = []

  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i]
    const mask = masks[i]
    const kind = view.index.entities[entity].kind
    let person: PersonAffinity | null = null
    let company: CompanyAffinity | null = null
    if (kind === 'person' || kind === 'franchise') {
      if ((mask & MAJOR_MASK) === 0) continue
      if (kind === 'person') person = context.person(entity)
    } else if (kind === 'company') {
      if ((mask & COMPANY_MASK) === 0) continue
      company = context.company(entity, startType)
      if (!company) continue
    } else {
      continue
    }

    const node = view.index.entities[entity]
    const unseen: PeopleRowMember[] = []
    const watched: PeopleRowMember[] = []
    for (let m = 0; m < node.titles.length; m += 1) {
      const title = node.titles[m]
      if (title === start || !view.allowed[title] || exclude(title)) continue
      const member = { title, mask: node.masks[m], seen: seen(title) }
      ;(member.seen ? watched : unseen).push(member)
    }
    const total = unseen.length + watched.length
    if (total === 0) continue

    const year = (title: number) => view.index.titles[title].year ?? -Infinity
    unseen.sort(
      (a, b) =>
        (scores.get(b.title) ?? 0) - (scores.get(a.title) ?? 0) || year(b.title) - year(a.title) || a.title - b.title
    )
    watched.sort((a, b) => year(b.title) - year(a.title) || a.title - b.title)
    const all = [...unseen, ...watched]

    const affinity = person?.score ?? (company ? company.score * NETWORK_AFFINITY_SHARE : 0)
    rows.push({
      entity,
      mask,
      person,
      company,
      members: all.slice(0, ROW_MEMBERS),
      more: Math.max(0, all.length - ROW_MEMBERS),
      // Unseen titles sort first, so only those past the cap are left out.
      moreUnseen: Math.max(0, unseen.length - ROW_MEMBERS),
      seenCount: watched.length,
      total,
      order: ROW_WEIGHTS.affinity * affinity + ROW_WEIGHTS.role * rowRoleStrength(kind, mask),
    })
  }

  // Strongest first; then the row with more left to see; then by name, so
  // the order is the same on every load.
  rows.sort(
    (a, b) =>
      b.order - a.order ||
      b.total - b.seenCount - (a.total - a.seenCount) ||
      view.index.entities[a.entity].name.localeCompare(view.index.entities[b.entity].name)
  )
  return rows.slice(0, PEOPLE_ROWS).map(({ order: _order, ...row }) => row)
}
