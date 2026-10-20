/**
 * The Trails index and the searches over it: a two-sided graph of titles
 * and the named things they carry (people, franchises, companies, keywords),
 * with a step between two titles costing what rules.ts says that shared thing
 * is worth.
 *
 * Built once from the whole library and narrowed per viewer by a VIEW (the
 * titles in their scope), so one index serves every scope and rarity is still
 * counted inside the viewer's own (rules.ts, rule 4).
 *
 * Kept compact on purpose — typed arrays and role bitmasks rather than an
 * object per credit — because it lives in memory for the API's lifetime and a
 * five-figure library holds several hundred thousand credits.
 *
 * Pure, pinned by trails.test.ts.
 */

import {
  HOP_COST,
  MAX_PATH_HOPS,
  ROLE_KIND,
  entityKey,
  formatTitleRef,
  linkCap,
  maskCost,
  rarity,
  roleBit,
  threadCost,
  type EntityKind,
  type LinkRole,
  type TitleType,
} from './rules.js'

export interface CreditSource {
  role: LinkRole
  /** What the entity is called on screen. */
  name: string
  /** A stable id when the source has one (a TMDb collection); else the name is the key. */
  key?: string | null
  /** A person's photo, when the media server has one. */
  photo?: string | null
}

export interface TitleSource {
  type: TitleType
  id: string
  title: string
  year: number | null
  posterUrl: string | null
  credits: readonly CreditSource[]
}

export interface IndexedTitle {
  type: TitleType
  id: string
  title: string
  year: number | null
  posterUrl: string | null
}

export interface IndexedEntity {
  kind: EntityKind
  name: string
  photo: string | null
  /** The titles carrying it, parallel to `masks`. */
  titles: Int32Array
  /** The roles each title gives it (rules.ts role masks). */
  masks: Uint16Array
}

export interface TrailIndex {
  titles: IndexedTitle[]
  byRef: Map<string, number>
  entities: IndexedEntity[]
  /** Per title: the entities it carries, parallel to `titleMasks`. */
  titleEntities: Int32Array[]
  titleMasks: Uint16Array[]
}

/**
 * Build the index. An entity only one title carries can never link anything,
 * whatever the scope, so it is dropped here rather than stored.
 */
export function buildTrailIndex(sources: Iterable<TitleSource>): TrailIndex {
  const titles: IndexedTitle[] = []
  const byRef = new Map<string, number>()
  const keyToEntity = new Map<string, number>()
  const kinds: EntityKind[] = []
  const names: string[] = []
  const photos: (string | null)[] = []
  const perTitle: Map<number, number>[] = []

  for (const source of sources) {
    const ref = formatTitleRef(source)
    if (byRef.has(ref)) continue
    byRef.set(ref, titles.length)
    titles.push({
      type: source.type,
      id: source.id.toLowerCase(),
      title: source.title,
      year: source.year,
      posterUrl: source.posterUrl,
    })

    const credits = new Map<number, number>()
    for (const credit of source.credits) {
      const kind = ROLE_KIND[credit.role]
      const name = credit.name?.trim() ?? ''
      if (!name) continue
      const stable = credit.key != null ? String(credit.key).trim() : ''
      const key = stable ? `${kind}:#${stable}` : entityKey(kind, name)
      if (!key) continue
      let entity = keyToEntity.get(key)
      if (entity === undefined) {
        entity = kinds.length
        keyToEntity.set(key, entity)
        kinds.push(kind)
        names.push(name)
        photos.push(credit.photo || null)
      } else if (!photos[entity] && credit.photo) {
        photos[entity] = credit.photo
      }
      credits.set(entity, (credits.get(entity) ?? 0) | roleBit(credit.role))
    }
    perTitle.push(credits)
  }

  const counts = new Int32Array(kinds.length)
  for (const credits of perTitle) {
    for (const entity of credits.keys()) counts[entity] += 1
  }

  const remap = new Int32Array(kinds.length).fill(-1)
  const entities: IndexedEntity[] = []
  for (let entity = 0; entity < kinds.length; entity += 1) {
    if (counts[entity] < 2) continue
    remap[entity] = entities.length
    entities.push({
      kind: kinds[entity],
      name: names[entity],
      photo: photos[entity],
      titles: new Int32Array(counts[entity]),
      masks: new Uint16Array(counts[entity]),
    })
  }

  const filled = new Int32Array(entities.length)
  const titleEntities: Int32Array[] = []
  const titleMasks: Uint16Array[] = []
  perTitle.forEach((credits, title) => {
    const kept = [...credits].filter(([entity]) => remap[entity] >= 0)
    const ids = new Int32Array(kept.length)
    const masks = new Uint16Array(kept.length)
    kept.forEach(([entity, mask], position) => {
      const id = remap[entity]
      ids[position] = id
      masks[position] = mask
      const target = entities[id]
      target.titles[filled[id]] = title
      target.masks[filled[id]] = mask
      filled[id] += 1
    })
    titleEntities.push(ids)
    titleMasks.push(masks)
  })

  return { titles, byRef, entities, titleEntities, titleMasks }
}

// ---------------------------------------------------------------------------
// A viewer's view of the index
// ---------------------------------------------------------------------------

export interface TrailView {
  index: TrailIndex
  /** 1 for a title in scope. */
  allowed: Uint8Array
  /** How many titles are in scope. */
  titleCount: number
  /** How many titles in scope carry an entity. */
  count(entity: number): number
  /** Whether an entity links anything in this scope (rules.ts, rule 3). */
  links(entity: number): boolean
}

/** A view over the titles in scope; null means every title. */
export function createView(index: TrailIndex, allowedTitles: Iterable<number> | null): TrailView {
  const allowed = new Uint8Array(index.titles.length)
  let titleCount = 0
  if (allowedTitles === null) {
    allowed.fill(1)
    titleCount = index.titles.length
  } else {
    for (const title of allowedTitles) {
      if (title >= 0 && title < allowed.length && allowed[title] === 0) {
        allowed[title] = 1
        titleCount += 1
      }
    }
  }

  const caps: Record<EntityKind, number> = {
    person: linkCap('person', titleCount),
    franchise: linkCap('franchise', titleCount),
    company: linkCap('company', titleCount),
    keyword: linkCap('keyword', titleCount),
  }
  // Counted on first use: a search touches a small fraction of the entities.
  const counts = new Int32Array(index.entities.length).fill(-1)
  const count = (entity: number): number => {
    if (counts[entity] < 0) {
      let carried = 0
      for (const title of index.entities[entity].titles) if (allowed[title]) carried += 1
      counts[entity] = carried
    }
    return counts[entity]
  }
  const links = (entity: number): boolean => {
    const carried = count(entity)
    return carried >= 2 && carried <= caps[index.entities[entity].kind]
  }

  return { index, allowed, titleCount, count, links }
}

// ---------------------------------------------------------------------------
// Paths between two titles
// ---------------------------------------------------------------------------

class MinHeap {
  private keys: number[] = []
  private values: number[] = []

  get size(): number {
    return this.keys.length
  }

  /** The smallest key; call only when size > 0. */
  peekKey(): number {
    return this.keys[0]
  }

  push(key: number, value: number): void {
    const keys = this.keys
    const values = this.values
    let at = keys.length
    keys.push(key)
    values.push(value)
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (keys[parent] <= key) break
      keys[at] = keys[parent]
      values[at] = values[parent]
      at = parent
    }
    keys[at] = key
    values[at] = value
  }

  /** The smallest value; call only when size > 0. */
  pop(): number {
    const keys = this.keys
    const values = this.values
    const top = values[0]
    const lastKey = keys.pop() as number
    const lastValue = values.pop() as number
    if (keys.length > 0) {
      let at = 0
      const length = keys.length
      for (;;) {
        const left = at * 2 + 1
        if (left >= length) break
        const right = left + 1
        const child = right < length && keys[right] < keys[left] ? right : left
        if (keys[child] >= lastKey) break
        keys[at] = keys[child]
        values[at] = values[child]
        at = child
      }
      keys[at] = lastKey
      values[at] = lastValue
    }
    return top
  }
}

export interface FoundPath {
  cost: number
  /** Titles from start to end. */
  titles: number[]
  /** The entity linking titles[i] to titles[i + 1]. */
  entities: number[]
}

export interface PathOptions {
  /** Titles a path may not pass through (never the ends). */
  banned?: ReadonlySet<number>
  maxHops?: number
}

/**
 * The cheapest path from one title to another within `maxHops` steps, or null
 * when there is none.
 *
 * Dijkstra over titles and entities, searched from both ends at once and
 * stopped when the two searches can no longer improve on the best meeting
 * point. Every title–entity edge costs half of HOP_COST plus half of that
 * title's role weight times the entity's rarity, so a path costs the sum of
 * rules.ts `stepCost` over its steps, whichever end it is read from — which is
 * what lets both ends search. One-ended, a dense library spent over 100 ms on
 * a route; most of that was the far side of the library the target sits
 * nowhere near.
 *
 * The step limit is exact, which is why every node is searched once PER STEP
 * COUNT (a state is a node and how many steps reached it). With one label per
 * node, a cheap prefix that had used too many steps claimed a title first and
 * hid a dearer prefix that fit, so a route inside the limit could be reported
 * as missing. A step limit of six makes that seven states per node per side.
 */
export function findPath(view: TrailView, from: number, to: number, options: PathOptions = {}): FoundPath | null {
  const { index, allowed } = view
  if (from === to || !allowed[from] || !allowed[to]) return null
  const maxHops = Math.max(1, options.maxHops ?? MAX_PATH_HOPS)
  const banned = options.banned
  const titleCount = index.titles.length
  const layers = maxHops + 1
  const stateCount = (titleCount + index.entities.length) * layers
  const stateOf = (node: number, steps: number) => node * layers + steps

  const makeSide = (start: number): SearchSide => {
    const side: SearchSide = {
      dist: new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY),
      prev: new Int32Array(stateCount).fill(-1),
      done: new Uint8Array(stateCount),
      heap: new MinHeap(),
    }
    side.dist[stateOf(start, 0)] = 0
    side.heap.push(0, stateOf(start, 0))
    return side
  }
  const forward = makeSide(from)
  const backward = makeSide(to)

  let best = Number.POSITIVE_INFINITY
  let meetForward = -1
  let meetBackward = -1
  // A path through a node joins a forward state and a backward state of that
  // node whose steps add up to no more than the limit (one more when the node
  // is an entity: the step through it is counted on neither side).
  const consider = (node: number, steps: number, side: SearchSide, other: SearchSide) => {
    const reached = side.dist[stateOf(node, steps)]
    const spare = maxHops - steps - (node >= titleCount ? 1 : 0)
    for (let otherSteps = 0; otherSteps <= spare; otherSteps += 1) {
      const total = reached + other.dist[stateOf(node, otherSteps)]
      if (total >= best) continue
      best = total
      meetForward = side === forward ? stateOf(node, steps) : stateOf(node, otherSteps)
      meetBackward = side === forward ? stateOf(node, otherSteps) : stateOf(node, steps)
    }
  }

  const expand = (side: SearchSide, other: SearchSide) => {
    const state = side.heap.pop()
    if (side.done[state]) return
    side.done[state] = 1
    const node = Math.floor(state / layers)
    const steps = state - node * layers
    const reached = side.dist[state]

    if (node < titleCount) {
      if (steps >= maxHops) return
      const entities = index.titleEntities[node]
      const masks = index.titleMasks[node]
      for (let i = 0; i < entities.length; i += 1) {
        const entity = entities[i]
        if (!view.links(entity)) continue
        const target = stateOf(titleCount + entity, steps)
        if (side.done[target]) continue
        const cost = reached + edgeCost(masks[i], view.count(entity))
        if (cost < side.dist[target]) {
          side.dist[target] = cost
          side.prev[target] = state
          side.heap.push(cost, target)
          consider(titleCount + entity, steps, side, other)
        }
      }
    } else {
      const entity = index.entities[node - titleCount]
      const carried = view.count(node - titleCount)
      const nextSteps = steps + 1
      for (let i = 0; i < entity.titles.length; i += 1) {
        const title = entity.titles[i]
        if (!allowed[title]) continue
        if (banned?.has(title) && title !== from && title !== to) continue
        const target = stateOf(title, nextSteps)
        if (side.done[target]) continue
        const cost = reached + edgeCost(entity.masks[i], carried)
        if (cost < side.dist[target]) {
          side.dist[target] = cost
          side.prev[target] = state
          side.heap.push(cost, target)
          consider(title, nextSteps, side, other)
        }
      }
    }
  }

  while (forward.heap.size > 0 && backward.heap.size > 0) {
    const forwardTop = forward.heap.peekKey()
    const backwardTop = backward.heap.peekKey()
    if (forwardTop + backwardTop >= best) break
    if (forwardTop <= backwardTop) expand(forward, backward)
    else expand(backward, forward)
  }

  if (meetForward < 0) return null
  // from … meeting node, then on to `to`; both meeting states are that node.
  const nodes: number[] = []
  for (let state = meetForward; state !== -1; state = forward.prev[state]) nodes.push(Math.floor(state / layers))
  nodes.reverse()
  for (let state = backward.prev[meetBackward]; state !== -1; state = backward.prev[state]) {
    nodes.push(Math.floor(state / layers))
  }
  const titles = nodes.filter((node) => node < titleCount)
  const entities = nodes.filter((node) => node >= titleCount).map((node) => node - titleCount)
  return { cost: best, titles, entities }
}

interface SearchSide {
  /** By state: a node and the steps taken from this side's end to reach it. */
  dist: Float64Array
  prev: Int32Array
  done: Uint8Array
  heap: MinHeap
}

/** One half of a step: entering or leaving an entity from one title. */
function edgeCost(mask: number, carried: number): number {
  return 0.5 * HOP_COST + 0.5 * maskCost(mask) * rarity(carried)
}

/**
 * Up to `limit` routes, each through titles none of the earlier ones used:
 * the best path, then the best path avoiding its middle, and so on. Three
 * routes through three different films say more than three variations on one.
 */
export function findPaths(
  view: TrailView,
  from: number,
  to: number,
  limit = 3,
  maxHops = MAX_PATH_HOPS
): FoundPath[] {
  const paths: FoundPath[] = []
  const banned = new Set<number>()
  while (paths.length < limit) {
    const path = findPath(view, from, to, { banned, maxHops })
    if (!path) break
    paths.push(path)
    const middle = path.titles.slice(1, -1)
    // A direct link has no middle to avoid, so a second route would be the
    // same step again; the other things the two share are its `alsoShared`.
    if (middle.length === 0) break
    for (const title of middle) banned.add(title)
  }
  return paths
}

export interface SharedLink {
  entity: number
  maskA: number
  maskB: number
  cost: number
}

/** Everything two titles share that links in this scope, strongest first. */
export function sharedLinks(view: TrailView, a: number, b: number): SharedLink[] {
  const { index } = view
  const ofA = new Map<number, number>()
  const entitiesA = index.titleEntities[a]
  const masksA = index.titleMasks[a]
  for (let i = 0; i < entitiesA.length; i += 1) ofA.set(entitiesA[i], masksA[i])
  const shared: SharedLink[] = []
  const entitiesB = index.titleEntities[b]
  const masksB = index.titleMasks[b]
  for (let i = 0; i < entitiesB.length; i += 1) {
    const entity = entitiesB[i]
    const maskA = ofA.get(entity)
    if (maskA === undefined || !view.links(entity)) continue
    const maskB = masksB[i]
    shared.push({
      entity,
      maskA,
      maskB,
      cost: HOP_COST + 0.5 * (maskCost(maskA) + maskCost(maskB)) * rarity(view.count(entity)),
    })
  }
  return shared.sort((x, y) => x.cost - y.cost || compareNames(view, x.entity, y.entity))
}

function compareNames(view: TrailView, a: number, b: number): number {
  return view.index.entities[a].name.localeCompare(view.index.entities[b].name)
}

// ---------------------------------------------------------------------------
// Threads from one title
// ---------------------------------------------------------------------------

export interface ThreadMember {
  title: number
  mask: number
}

export interface Thread {
  entity: number
  /** The roles the starting title gives it. */
  mask: number
  /** Titles in scope carrying it, the starting one included. */
  count: number
  cost: number
  /** Some of the other titles carrying it, in release order. */
  others: ThreadMember[]
  /** How many others were left out. */
  more: number
}

/** The most threads one title answers with. */
export const MAX_THREADS = 30
/** The most titles one thread names; the rest are counted in `more`. */
export const THREAD_MEMBERS = 12

export interface ThreadOptions {
  maxThreads?: number
  perThread?: number
}

/**
 * Every named thing a title shares with others in scope, strongest first, each
 * with the titles it leads to. Where a thread leads to more titles than fit,
 * the ones kept are those where the entity's role is strongest (a director's
 * films before their cameos), then shown oldest first so a person's thread
 * reads as a filmography.
 */
export function titleThreads(view: TrailView, title: number, options: ThreadOptions = {}): Thread[] {
  const { index, allowed } = view
  if (!allowed[title]) return []
  const maxThreads = options.maxThreads ?? MAX_THREADS
  const perThread = options.perThread ?? THREAD_MEMBERS
  const threads: Thread[] = []
  const entities = index.titleEntities[title]
  const masks = index.titleMasks[title]

  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i]
    if (!view.links(entity)) continue
    const carried = view.count(entity)
    const record = index.entities[entity]
    const members: ThreadMember[] = []
    for (let j = 0; j < record.titles.length; j += 1) {
      const other = record.titles[j]
      if (other !== title && allowed[other]) members.push({ title: other, mask: record.masks[j] })
    }
    members.sort(
      (a, b) =>
        maskCost(a.mask) - maskCost(b.mask) ||
        (index.titles[b.title].year ?? 0) - (index.titles[a.title].year ?? 0)
    )
    const others = members.slice(0, perThread).sort((a, b) => byRelease(view, a.title, b.title))
    threads.push({
      entity,
      mask: masks[i],
      count: carried,
      cost: threadCost(masks[i], carried),
      others,
      more: members.length - others.length,
    })
  }

  return threads
    .sort((a, b) => a.cost - b.cost || a.count - b.count || compareNames(view, a.entity, b.entity))
    .slice(0, maxThreads)
}

function byRelease(view: TrailView, a: number, b: number): number {
  const ya = view.index.titles[a].year
  const yb = view.index.titles[b].year
  if (ya == null && yb == null) return view.index.titles[a].title.localeCompare(view.index.titles[b].title)
  if (ya == null) return 1
  if (yb == null) return -1
  return ya - yb || view.index.titles[a].title.localeCompare(view.index.titles[b].title)
}

// ---------------------------------------------------------------------------
// What several titles have in common
// ---------------------------------------------------------------------------

export interface CommonLink {
  entity: number
  /** Titles in scope carrying it. */
  count: number
  /** The chosen titles carrying it, in the order they were chosen. */
  carriers: ThreadMember[]
  score: number
}

/**
 * The named things at least two of the chosen titles share, best first: shared
 * by more of them before fewer, and among those the rarer and the stronger
 * role first.
 */
export function commonGround(view: TrailView, chosen: readonly number[], limit = 40): CommonLink[] {
  const { index, allowed } = view
  const carriersOf = new Map<number, ThreadMember[]>()
  const seen = new Set<number>()
  for (const title of chosen) {
    if (!allowed[title] || seen.has(title)) continue
    seen.add(title)
    const entities = index.titleEntities[title]
    const masks = index.titleMasks[title]
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i]
      if (!view.links(entity)) continue
      const list = carriersOf.get(entity)
      if (list) list.push({ title, mask: masks[i] })
      else carriersOf.set(entity, [{ title, mask: masks[i] }])
    }
  }

  const links: CommonLink[] = []
  for (const [entity, carriers] of carriersOf) {
    if (carriers.length < 2) continue
    const count = view.count(entity)
    const meanCost = carriers.reduce((sum, member) => sum + maskCost(member.mask), 0) / carriers.length
    links.push({ entity, count, carriers, score: 1 / (meanCost * rarity(count)) })
  }
  return links
    .sort(
      (a, b) =>
        b.carriers.length - a.carriers.length ||
        b.score - a.score ||
        compareNames(view, a.entity, b.entity)
    )
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Surprise pairs
// ---------------------------------------------------------------------------

/** How many of a title's entities link anything in this scope. */
export function linkedThreadCount(view: TrailView, title: number): number {
  let linked = 0
  for (const entity of view.index.titleEntities[title]) if (view.links(entity)) linked += 1
  return linked
}

/**
 * A random title in scope with at least `minThreads` threads, or null when a
 * bounded number of draws finds none (a library with almost no credits).
 */
export function pickWellConnected(view: TrailView, random: () => number, minThreads = 4): number | null {
  const total = view.index.titles.length
  if (total === 0 || view.titleCount === 0) return null
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const title = Math.floor(random() * total)
    if (view.allowed[title] && linkedThreadCount(view, title) >= minThreads) return title
  }
  return null
}

/**
 * A title some steps away from `from` (counted in steps, not cost): far enough
 * that the path between them is worth reading, near enough to exist. Null when
 * nothing lies that far.
 */
export function pickDistantTitle(
  view: TrailView,
  from: number,
  random: () => number,
  minHops = 3,
  maxHops = 4
): number | null {
  const { index, allowed } = view
  const depth = new Int16Array(index.titles.length).fill(-1)
  const usedEntity = new Uint8Array(index.entities.length)
  depth[from] = 0
  let frontier = [from]
  const candidates: number[] = []
  for (let step = 1; step <= maxHops && frontier.length > 0; step += 1) {
    const next: number[] = []
    for (const title of frontier) {
      for (const entity of index.titleEntities[title]) {
        if (usedEntity[entity] || !view.links(entity)) continue
        usedEntity[entity] = 1
        for (const other of index.entities[entity].titles) {
          if (!allowed[other] || depth[other] >= 0) continue
          depth[other] = step
          next.push(other)
          if (step >= minHops) candidates.push(other)
        }
      }
    }
    frontier = next
  }
  if (candidates.length === 0) return null
  return candidates[Math.floor(random() * candidates.length)]
}

// ---------------------------------------------------------------------------
// What the index looks like, for the log
// ---------------------------------------------------------------------------

export interface IndexDescription {
  titles: number
  /** Entities that link something in this scope, by kind. */
  linkingEntities: Record<EntityKind, number>
  /** Entities two or more titles carry but too many to link (rules.ts, rule 3). */
  cappedEntities: Record<EntityKind, number>
  /** Threads per title: how many linking entities a title carries. */
  threadsPerTitle: { p10: number; median: number; p90: number }
  /** Titles with no thread at all. */
  isolatedTitles: number
}

function percentile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]
}

/**
 * The measurement the weights in rules.ts are provisional on: how many threads
 * an ordinary title has, how many are isolated, and how much the caps remove.
 */
export function describeIndex(view: TrailView): IndexDescription {
  const { index, allowed } = view
  const zero = (): Record<EntityKind, number> => ({ person: 0, franchise: 0, company: 0, keyword: 0 })
  const linkingEntities = zero()
  const cappedEntities = zero()
  index.entities.forEach((entity, id) => {
    const carried = view.count(id)
    if (carried < 2) return
    if (view.links(id)) linkingEntities[entity.kind] += 1
    else cappedEntities[entity.kind] += 1
  })
  const perTitle: number[] = []
  for (let title = 0; title < index.titles.length; title += 1) {
    if (allowed[title]) perTitle.push(linkedThreadCount(view, title))
  }
  perTitle.sort((a, b) => a - b)
  return {
    titles: view.titleCount,
    linkingEntities,
    cappedEntities,
    threadsPerTitle: {
      p10: percentile(perTitle, 0.1),
      median: percentile(perTitle, 0.5),
      p90: percentile(perTitle, 0.9),
    },
    isolatedTitles: perTitle.filter((threads) => threads === 0).length,
  }
}
