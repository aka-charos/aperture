/**
 * The pure middle of Next from here: what the viewer's own record says about
 * the people and companies on a title, and how a candidate is scored and
 * explained. Reads a Trails view (trails/graph.ts) and plain numbers; no DB.
 *
 * Pinned by nextFromHere.test.ts.
 */

import { MIN_SKEW_SCORE, skewOf } from '../lib/tasteEvidence.js'
import type { TrailView } from '../trails/graph.js'
import { roleBit } from '../trails/rules.js'
import {
  DIFFERENT_SIDE_ITEMS,
  CLOSE_ITEMS,
  LIKED_WEIGHT,
  LINKED_PER_ENTITY,
  MAJOR_MASK,
  MIN_PERSON_TITLES,
  NETWORK_AFFINITY_SHARE,
  PER_ENTITY_CAP,
  blendScore,
  closenessFromRank,
  sharedRoleStrength,
} from './rules.js'

/** What the viewer's record says about one indexed title. */
export interface ViewerTitle {
  /** rules.ts `titleWeight`. */
  weight: number
  rating: number | null
  finished: boolean
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** How much the viewer's record favours one person, when it does. */
export interface PersonAffinity {
  /** In [0, 1]. */
  score: number
  /** Titles with them (in a major role) the viewer liked. */
  liked: number
  /** The viewer's mean rating over every title of theirs they rated; null when none were. */
  averageRating: number | null
}

/** Shrinks a thin record toward nothing: two titles say less than ten. */
const PERSON_SHRINK = 2

/**
 * A person's standing with this viewer, from the titles where they had a
 * major role (rules.ts MAJOR_ROLES) and the viewer has a record. Null below
 * MIN_PERSON_TITLES liked titles, or when the record is mixed to negative:
 * "you keep coming back to them" has to be true to be said.
 */
export function personAffinity(
  view: TrailView,
  entity: number,
  record: ReadonlyMap<number, ViewerTitle>
): PersonAffinity | null {
  const node = view.index.entities[entity]
  if (node.kind !== 'person') return null
  let total = 0
  let counted = 0
  let liked = 0
  let ratingSum = 0
  let rated = 0
  for (let i = 0; i < node.titles.length; i += 1) {
    if ((node.masks[i] & MAJOR_MASK) === 0) continue
    const title = node.titles[i]
    if (!view.allowed[title]) continue
    const mine = record.get(title)
    if (!mine) continue
    total += mine.weight
    counted += 1
    if (mine.weight >= LIKED_WEIGHT) liked += 1
    // Every rating of theirs, not only the liked ones: an average said to the
    // viewer's face must not leave out the ones they rated low.
    if (mine.rating != null) {
      ratingSum += mine.rating
      rated += 1
    }
  }
  if (liked < MIN_PERSON_TITLES || counted === 0) return null
  const mean = total / counted
  if (mean <= 0) return null
  return {
    score: Math.min(1, mean * (counted / (counted + PERSON_SHRINK))),
    liked,
    averageRating: rated > 0 ? Math.round((ratingSum / rated) * 10) / 10 : null,
  }
}

// ---------------------------------------------------------------------------
// Companies: studios and networks, by skew
// ---------------------------------------------------------------------------

/** How much more of a company's titles the viewer finishes than its library share predicts. */
export interface CompanyAffinity {
  /** In [0, 1]. */
  score: number
  /** The viewer's finished titles of this type carrying it. */
  finished: number
  /** finished ÷ what the library share predicts, e.g. 3.1 for "three times". */
  ratio: number
}

/** `FACET_RULES.network` in the Watcher Identity: the same measure, the same bar. */
export const COMPANY_MIN_FINISHED = 2
export const COMPANY_SHRINK = 3
/** A skew score this high or more is full strength (log2: four times, before shrinking). */
const COMPANY_FULL_SCORE = 2

/**
 * Per media type, what the skew is measured against: the titles in scope of
 * that type, and the viewer's finished-and-not-disliked titles of it. A
 * catch-all studio on two hundred films finishes as often as the library
 * predicts and scores nothing, which is the point.
 */
export interface CompanyBase {
  availableByType: Record<'movie' | 'series', number>
  finishedByType: Record<'movie' | 'series', number>
}

export function companyBase(view: TrailView, record: ReadonlyMap<number, ViewerTitle>): CompanyBase {
  const availableByType = { movie: 0, series: 0 }
  const finishedByType = { movie: 0, series: 0 }
  for (let title = 0; title < view.index.titles.length; title += 1) {
    if (!view.allowed[title]) continue
    const type = view.index.titles[title].type
    availableByType[type] += 1
    if (countsAsFinished(record.get(title))) finishedByType[type] += 1
  }
  return { availableByType, finishedByType }
}

function countsAsFinished(mine: ViewerTitle | undefined): boolean {
  return mine != null && mine.finished && mine.weight > 0
}

export function companyAffinity(
  view: TrailView,
  entity: number,
  type: 'movie' | 'series',
  record: ReadonlyMap<number, ViewerTitle>,
  base: CompanyBase
): CompanyAffinity | null {
  const node = view.index.entities[entity]
  if (node.kind !== 'company') return null
  let available = 0
  let finished = 0
  for (const title of node.titles) {
    if (!view.allowed[title] || view.index.titles[title].type !== type) continue
    available += 1
    if (countsAsFinished(record.get(title))) finished += 1
  }
  if (finished < COMPANY_MIN_FINISHED) return null
  const skew = skewOf(finished, available, base.finishedByType[type], base.availableByType[type], COMPANY_SHRINK)
  if (!skew || skew.score < MIN_SKEW_SCORE) return null
  return {
    score: Math.min(1, skew.score / COMPANY_FULL_SCORE),
    finished,
    ratio: Math.round(skew.ratio * 10) / 10,
  }
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export type Reason =
  | { kind: 'feel'; rank: number }
  | { kind: 'shared'; entity: number; rolesStartMask: number; rolesHereMask: number }
  | { kind: 'favourite'; entity: number; rolesHereMask: number; liked: number; averageRating: number | null }
  | { kind: 'company'; entity: number; finished: number; ratio: number }

/** Close in feel only, close and sharing someone, or sharing someone and feeling different. */
export type Quadrant = 'close' | 'closeLinked' | 'linkedDifferent'

export interface Candidate {
  title: number
  quadrant: Quadrant
  score: number
  reasons: Reason[]
  /** The shared credits, for keeping one person from filling a list. */
  sharedEntities: number[]
}

export interface CandidateInput {
  view: TrailView
  start: number
  /**
   * The start's neighbours by embedding, as index positions. Films and shows
   * may be interleaved (the similarity graph reserves slots for the other
   * media type); each title is ranked only among neighbours of its own type,
   * since film and show distances are two populations (similarity/crossMedia.ts).
   */
  neighbours: readonly number[]
  record: ReadonlyMap<number, ViewerTitle>
  /** Titles never to suggest: the viewer's finished ones. */
  exclude: (title: number) => boolean
}

/** The major-role credits a title carries, as entity → mask. */
function majorCredits(view: TrailView, title: number, extraMask = 0): Map<number, number> {
  const out = new Map<number, number>()
  const entities = view.index.titleEntities[title]
  const masks = view.index.titleMasks[title]
  for (let i = 0; i < entities.length; i += 1) {
    if ((masks[i] & (MAJOR_MASK | extraMask)) !== 0) out.set(entities[i], masks[i])
  }
  return out
}

const COMPANY_MASK = roleBit('studio') | roleBit('network')

/**
 * Every candidate worth listing from one start, scored and explained. A
 * neighbour by embedding is a candidate; so is any title sharing a major-role
 * credit with the start, in a major role there too — an actor directing
 * counts, a lead turning up four names down a cast list does not.
 */
export function scoreCandidates(input: CandidateInput): Candidate[] {
  const { view, start, record, exclude } = input
  const fromStart = majorCredits(view, start)
  const base = companyBase(view, record)
  // Rank within the neighbour's own media type, 0 the closest.
  const rankOf = new Map<number, number>()
  const typeCount = { movie: 0, series: 0 }
  for (const title of input.neighbours) {
    if (rankOf.has(title)) continue
    const type = view.index.titles[title].type
    rankOf.set(title, typeCount[type])
    typeCount[type] += 1
  }

  const eligible = (title: number) => title !== start && view.allowed[title] === 1 && !exclude(title)
  const pool = new Set<number>(rankOf.keys())
  for (const [entity] of fromStart) {
    const node = view.index.entities[entity]
    let taken = 0
    // Only titles that could be listed use up the allowance, or a prolific
    // person's unseen work is crowded out by what the viewer already saw.
    for (let i = 0; i < node.titles.length && taken < LINKED_PER_ENTITY; i += 1) {
      if ((node.masks[i] & MAJOR_MASK) === 0 || !eligible(node.titles[i])) continue
      pool.add(node.titles[i])
      taken += 1
    }
  }

  const personCache = new Map<number, PersonAffinity | null>()
  const companyCache = new Map<string, CompanyAffinity | null>()
  const out: Candidate[] = []

  for (const title of pool) {
    if (!eligible(title)) continue
    const type = view.index.titles[title].type
    const credits = majorCredits(view, title, COMPANY_MASK)
    const reasons: Reason[] = []

    const rank = rankOf.get(title)
    const closeness = rank == null ? 0 : closenessFromRank(rank, typeCount[type])
    if (rank != null) reasons.push({ kind: 'feel', rank: rank + 1 })

    // What it shares with the start, strongest first.
    const shared: Array<{ entity: number; startMask: number; hereMask: number; strength: number }> = []
    for (const [entity, hereMask] of credits) {
      const startMask = fromStart.get(entity)
      if (startMask === undefined || (hereMask & MAJOR_MASK) === 0) continue
      const strength = Math.min(sharedRoleStrength(startMask), sharedRoleStrength(hereMask))
      if (strength > 0) shared.push({ entity, startMask, hereMask, strength })
    }
    shared.sort((a, b) => b.strength - a.strength)
    for (const link of shared.slice(0, 2)) {
      reasons.push({ kind: 'shared', entity: link.entity, rolesStartMask: link.startMask, rolesHereMask: link.hereMask })
    }

    // The viewer's own favourites on it, not already named as shared.
    const sharedSet = new Set(shared.map((link) => link.entity))
    let favourite: { entity: number; mask: number; affinity: PersonAffinity } | null = null
    let company: { entity: number; affinity: CompanyAffinity } | null = null
    for (const [entity, hereMask] of credits) {
      const kind = view.index.entities[entity].kind
      if (kind === 'person' && (hereMask & MAJOR_MASK) !== 0) {
        if (!personCache.has(entity)) personCache.set(entity, personAffinity(view, entity, record))
        const affinity = personCache.get(entity)
        if (affinity && (!favourite || affinity.score > favourite.affinity.score)) {
          favourite = { entity, mask: hereMask, affinity }
        }
      } else if (kind === 'company') {
        const key = `${entity}:${type}`
        if (!companyCache.has(key)) companyCache.set(key, companyAffinity(view, entity, type, record, base))
        const affinity = companyCache.get(key)
        if (affinity && (!company || affinity.score > company.affinity.score)) company = { entity, affinity }
      }
    }
    if (favourite && !sharedSet.has(favourite.entity)) {
      reasons.push({
        kind: 'favourite',
        entity: favourite.entity,
        rolesHereMask: favourite.mask,
        liked: favourite.affinity.liked,
        averageRating: favourite.affinity.averageRating,
      })
    }
    if (company) {
      reasons.push({
        kind: 'company',
        entity: company.entity,
        finished: company.affinity.finished,
        ratio: company.affinity.ratio,
      })
    }

    const affinity = Math.max(
      favourite?.affinity.score ?? 0,
      (company?.affinity.score ?? 0) * NETWORK_AFFINITY_SHARE
    )
    const sharedStrength = shared[0]?.strength ?? 0
    if (rank == null && sharedStrength === 0) continue
    // Off the neighbour list it is "the same PEOPLE, a different feel": a
    // franchise alone is not people, and its next part is the one suggestion
    // nobody needs.
    if (rank == null && !shared.some((link) => view.index.entities[link.entity].kind === 'person')) continue

    out.push({
      title,
      quadrant: rank == null ? 'linkedDifferent' : sharedStrength > 0 ? 'closeLinked' : 'close',
      score: blendScore({ closeness, shared: sharedStrength, affinity }),
      reasons,
      sharedEntities: shared.map((link) => link.entity),
    })
  }

  // Deterministic: score, then index position.
  out.sort((a, b) => b.score - a.score || a.title - b.title)
  return out
}

/**
 * The two lists the page shows. "Close" is the embedding's side (with or
 * without a shared credit); "different" is the side the embedding cannot
 * see — the same people, in a title that feels unlike this one — with no one
 * person or franchise allowed more than PER_ENTITY_CAP places, or a
 * director's filmography fills it.
 */
export function pickSections(candidates: readonly Candidate[]): { close: Candidate[]; different: Candidate[] } {
  const close = candidates.filter((c) => c.quadrant !== 'linkedDifferent').slice(0, CLOSE_ITEMS)
  const different: Candidate[] = []
  const used = new Map<number, number>()
  for (const candidate of candidates) {
    if (different.length >= DIFFERENT_SIDE_ITEMS) break
    if (candidate.quadrant !== 'linkedDifferent') continue
    const lead = candidate.sharedEntities[0]
    if (lead !== undefined && (used.get(lead) ?? 0) >= PER_ENTITY_CAP) continue
    if (lead !== undefined) used.set(lead, (used.get(lead) ?? 0) + 1)
    different.push(candidate)
  }
  return { close, different }
}
