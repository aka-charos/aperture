/**
 * What links two library titles in Trails, and how strongly.
 *
 * The Explore graph draws embedding neighbours and labels each line after the
 * fact with whatever the two titles happen to share, so a line means "these
 * vectors are close" and its label is decoration. Trails works the other
 * way round: a link exists only because two titles share a NAMED thing — a
 * person, a franchise, a company, an uncommon keyword — and how much a link is
 * worth is decided by how rare that thing is in the viewer's library. Dante
 * Spinotti shooting two films is a discovery; Warner Bros. distributing two
 * hundred is not.
 *
 * Five rules.
 *
 * 1. **People are one entity whatever their role.** Clint Eastwood starring in
 *    one title and directing another is exactly the kind of link worth finding,
 *    so a credit is a (person, role) pair and the person is the key. Two people
 *    sharing one name are one entity here; the media server's names are the
 *    only identity this has, and that is the accepted cost.
 * 2. **A role sets the base weight, rarity multiplies it.** Directing both is a
 *    stronger reason than appearing in both, and a keyword weaker still. The
 *    multiplier is log2 of how many titles in the viewer's scope carry the
 *    entity, so a thing two titles share costs its base weight once, and each
 *    doubling of its reach adds the base weight again.
 * 3. **An entity carried by too many titles links nothing.** Past a cap scaled
 *    to the library (`linkCap`), a keyword or a studio stops being a reason and
 *    becomes a category, and letting it through puts every title two steps from
 *    every other — the reason the graph felt like a toy. The failure is
 *    asymmetric on purpose: a cap set too low loses a weak link the viewer can
 *    still find through its titles; one set too high draws "both tagged
 *    'based on novel'" as if it meant something.
 * 4. **Rarity is counted in the viewer's scope**, never the whole server: a
 *    count that included titles they cannot open would leak those titles'
 *    existence through "shared by 4 titles" while showing three.
 * 5. **Genre and country are deliberately not links.** Every title has them and
 *    they carry no name to follow; the Explore graph already shows them.
 *
 * Pure, pinned by trails.test.ts. Every weight here is a provisional
 * design choice, not a measurement; `describeIndex` logs what they produce on
 * a real library at every index build so they can be revisited from numbers.
 */

export type EntityKind = 'person' | 'franchise' | 'company' | 'keyword'

export type LinkRole =
  | 'franchise'
  | 'director'
  | 'creator'
  | 'writer'
  | 'lead'
  | 'cinematographer'
  | 'composer'
  | 'editor'
  | 'actor'
  | 'keyword'
  | 'studio'
  | 'network'

/** Every role, strongest first. Also the bit order of a role mask. */
export const LINK_ROLES: readonly LinkRole[] = [
  'franchise',
  'director',
  'creator',
  'writer',
  'lead',
  'cinematographer',
  'composer',
  'editor',
  'actor',
  'keyword',
  'studio',
  'network',
]

/** The base cost of a link through a role; lower is a stronger reason. */
export const ROLE_COST: Record<LinkRole, number> = {
  franchise: 0.5,
  director: 1,
  creator: 1,
  writer: 1.15,
  lead: 1.2,
  cinematographer: 1.25,
  composer: 1.35,
  editor: 1.45,
  actor: 1.5,
  keyword: 2,
  studio: 2.4,
  network: 2.4,
}

export const ROLE_KIND: Record<LinkRole, EntityKind> = {
  franchise: 'franchise',
  director: 'person',
  creator: 'person',
  writer: 'person',
  lead: 'person',
  cinematographer: 'person',
  composer: 'person',
  editor: 'person',
  actor: 'person',
  keyword: 'keyword',
  studio: 'company',
  network: 'company',
}

/** Billed actors read as cast at all; past this a credit is a bit part in a long list. */
export const MAX_BILLED_ACTORS = 12
/** Billed this high, an actor is a lead. */
export const LEAD_BILLING = 3

/**
 * Added to every step of a path, so of two routes with similar link strength
 * the shorter wins: each extra title is one more thing to read.
 */
export const HOP_COST = 0.75
/** The longest path offered, in steps. Past this a path explains nothing. */
export const MAX_PATH_HOPS = 6

/**
 * The cap on how many titles in scope may carry an entity before it stops
 * linking anything (rule 3): a share of the library, held between a floor (so
 * a small library still has links) and an absolute ceiling (so a large one
 * does not admit a category). Franchises are never capped — the largest is a
 * few dozen titles, and every one of them belongs.
 */
const CAP_SHARE: Record<EntityKind, number> = {
  person: 0.02,
  franchise: Number.POSITIVE_INFINITY,
  company: 0.02,
  keyword: 0.015,
}
const CAP_CEILING: Record<EntityKind, number> = {
  person: 150,
  franchise: Number.POSITIVE_INFINITY,
  company: 120,
  keyword: 200,
}
const CAP_FLOOR = 8

export function linkCap(kind: EntityKind, titleCount: number): number {
  if (kind === 'franchise') return Number.POSITIVE_INFINITY
  const scaled = Math.ceil(CAP_SHARE[kind] * Math.max(0, titleCount))
  return Math.max(CAP_FLOOR, Math.min(CAP_CEILING[kind], scaled))
}

/** Whether an entity carried by `count` titles in scope links anything (rule 3). */
export function entityLinks(kind: EntityKind, count: number, titleCount: number): boolean {
  return count >= 2 && count <= linkCap(kind, titleCount)
}

/** log2 of how many titles carry it; 1 for a thing exactly two titles share. */
export function rarity(count: number): number {
  return Math.log2(Math.max(2, count))
}

// ---------------------------------------------------------------------------
// Role masks: the roles one title gives one entity, as bits in LINK_ROLES order.
// ---------------------------------------------------------------------------

const ROLE_BIT = new Map(LINK_ROLES.map((role, index) => [role, 1 << index]))

export function roleBit(role: LinkRole): number {
  return ROLE_BIT.get(role) ?? 0
}

/** The roles in a mask, strongest first. */
export function rolesOf(mask: number): LinkRole[] {
  return LINK_ROLES.filter((role) => (mask & roleBit(role)) !== 0)
}

/** Every mask's cost, worked out once: the path search asks on every edge. */
const MASK_COSTS = (() => {
  const costs = new Float64Array(1 << LINK_ROLES.length).fill(Number.POSITIVE_INFINITY)
  for (let mask = 1; mask < costs.length; mask += 1) {
    const strongest = LINK_ROLES.find((role) => (mask & roleBit(role)) !== 0)
    if (strongest) costs[mask] = ROLE_COST[strongest]
  }
  return costs
})()

/** The base cost of the strongest role in a mask; an empty mask never links. */
export function maskCost(mask: number): number {
  return MASK_COSTS[mask] ?? Number.POSITIVE_INFINITY
}

/**
 * One step between two titles through a shared entity. Each side pays half of
 * its own role's weight, so Eastwood acting in one and directing the other
 * sits between "acted in both" and "directed both", and the cost is the same
 * read in either direction.
 */
export function stepCost(maskA: number, maskB: number, count: number): number {
  return HOP_COST + 0.5 * (maskCost(maskA) + maskCost(maskB)) * rarity(count)
}

/** How strong a thread from one title is: its role there, times rarity. */
export function threadCost(mask: number, count: number): number {
  return maskCost(mask) * rarity(count)
}

// ---------------------------------------------------------------------------
// Names and references
// ---------------------------------------------------------------------------

/**
 * A name as an identity: case, width and spacing folded, accents KEPT —
 * "Jose" and "José" are sometimes two people, and the media server writes one
 * person's name the same way on every title it credits them on.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The index key of an entity, or null when the name is empty. */
export function entityKey(kind: EntityKind, name: string): string | null {
  const normalized = normalizeName(name)
  return normalized ? `${kind}:${normalized}` : null
}

export type TitleType = 'movie' | 'series'

export interface TitleRef {
  type: TitleType
  id: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `movie:<uuid>` or `series:<uuid>`, else null. Ids are lowercased. */
export function parseTitleRef(raw: unknown): TitleRef | null {
  if (typeof raw !== 'string') return null
  const match = /^(movie|series):(.+)$/.exec(raw.trim())
  if (!match || !UUID.test(match[2])) return null
  return { type: match[1] as TitleType, id: match[2].toLowerCase() }
}

export function formatTitleRef(ref: TitleRef): string {
  return `${ref.type}:${ref.id.toLowerCase()}`
}
