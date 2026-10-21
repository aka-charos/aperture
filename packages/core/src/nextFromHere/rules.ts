/**
 * Next from here: what to watch after a title, told in reasons a person can
 * check. Two signals, each covering the other's blind spot:
 *
 * - **How close it feels**, from the embedding (the similarity graph's signal).
 *   It places titles well and explains nothing.
 * - **Who made it**, from the named credits (the Trails index). It explains
 *   everything and, weighted by rarity, chained bit-part actors into trivia.
 *
 * So credits are weighed here by the VIEWER'S OWN TASTE, never by how rare
 * they are in the library: a person counts when they recur across titles this
 * viewer finished and rated well, and only in a role that shapes a title
 * (director, creator, writer, cinematographer, composer, a lead, a franchise).
 * Bit parts, editors, keywords and studios link nothing here. A TV network
 * counts by the Watcher Identity's own skew measure (`skewOf`): how much more
 * of its shows the viewer finishes than its share of the library predicts.
 *
 * Pure, pinned by nextFromHere.test.ts. Every weight is provisional.
 */

import { roleBit, type LinkRole } from '../trails/rules.js'

/** The roles that make a credit a reason. Everything else links nothing here. */
export const MAJOR_ROLES: readonly LinkRole[] = [
  'franchise',
  'director',
  'creator',
  'writer',
  'cinematographer',
  'composer',
  'lead',
]

export const MAJOR_MASK = MAJOR_ROLES.reduce((mask, role) => mask | roleBit(role), 0)

/** A network's own bit; the network kind is a company credited as broadcaster. */
export const NETWORK_MASK = roleBit('network')

/**
 * How much one title says about what its makers are worth to this viewer.
 * A rating is the strongest evidence and decides alone; an unrated title
 * finished is a mild yes; one started and dropped says nothing either way
 * (people stop shows for every reason). Disliked titles count against.
 */
export function titleWeight(input: { rating: number | null; finished: boolean }): number {
  const { rating, finished } = input
  if (rating != null && Number.isFinite(rating)) {
    if (rating >= 9) return 1
    if (rating >= 8) return 0.9
    if (rating >= 7) return 0.7
    if (rating >= 6) return 0.3
    if (rating >= 5) return 0
    if (rating >= 4) return -0.4
    return -1
  }
  return finished ? 0.5 : 0
}

/** A title counts as one the viewer liked at or above this weight. */
export const LIKED_WEIGHT = 0.5

/** "Keeps coming back to": a person needs this many liked titles to count. */
export const MIN_PERSON_TITLES = 2

/**
 * How close a neighbour is, from its rank among the start's neighbours (0 is
 * the closest). Ranked, never a raw cosine: neighbour cosines crowd into a
 * band a few points wide (the repo's cosine invariant), and a rank is true
 * without calibrating one.
 */
export function closenessFromRank(rank: number, poolSize: number): number {
  if (!Number.isFinite(rank) || rank < 0 || poolSize <= 0) return 0
  return Math.max(0, 1 - rank / poolSize)
}

/**
 * How strong a reason sharing someone with the start is, by the role they
 * have here. A franchise is the weakest: the next part of a series is the
 * one recommendation nobody needs.
 */
export function sharedRoleStrength(mask: number): number {
  if (mask & (roleBit('director') | roleBit('creator') | roleBit('writer'))) return 1
  if (mask & (roleBit('cinematographer') | roleBit('composer'))) return 0.8
  if (mask & roleBit('lead')) return 0.7
  if (mask & roleBit('franchise')) return 0.3
  return 0
}

/** The blend; provisional, and the reasons beside each item are what to read. */
export const SCORE_WEIGHTS = { closeness: 0.5, sharedWithStart: 0.25, affinity: 0.25 } as const

/** How strongly a favourite network counts against a favourite person. */
export const NETWORK_AFFINITY_SHARE = 0.7

export function blendScore(parts: { closeness: number; shared: number; affinity: number }): number {
  return (
    SCORE_WEIGHTS.closeness * parts.closeness +
    SCORE_WEIGHTS.sharedWithStart * parts.shared +
    SCORE_WEIGHTS.affinity * parts.affinity
  )
}

/** Titles listed in each section. */
export const CLOSE_ITEMS = 12
export const DIFFERENT_SIDE_ITEMS = 6
/** Neighbours asked of the embedding (films and shows together). */
export const NEIGHBOUR_POOL = 50
/** At most this many titles per person or franchise in the different-side list. */
export const PER_ENTITY_CAP = 2
/** Listable titles looked at per shared credit: a lead with sixty films is not read whole. */
export const LINKED_PER_ENTITY = 40
/** Recent titles offered as places to start from. */
export const STARTS_OFFERED = 8
