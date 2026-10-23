/**
 * The Trails index and what is read from it: a two-sided graph of titles and
 * the named things they carry (people, franchises, companies, keywords), with
 * a step between two titles costing what rules.ts says that shared thing is
 * worth. A trail is walked one title at a time, along the threads out of the
 * title it stands on.
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
  ROLE_KIND,
  entityKey,
  formatTitleRef,
  linkCap,
  roleBit,
  stepCost,
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
  /** Stable across rebuilds (rules.ts `entityKey`, or the source's own id): how a client names it. */
  key: string
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
  byKey: Map<string, number>
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
  const keys: string[] = []
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
        keys.push(key)
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
  const byKey = new Map<string, number>()
  for (let entity = 0; entity < kinds.length; entity += 1) {
    if (counts[entity] < 2) continue
    remap[entity] = entities.length
    byKey.set(keys[entity], entities.length)
    entities.push({
      key: keys[entity],
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

  return { titles, byRef, entities, byKey, titleEntities, titleMasks }
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
// What two titles share
// ---------------------------------------------------------------------------

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
    shared.push({ entity, maskA, maskB, cost: stepCost(maskA, maskB, view.count(entity)) })
  }
  return shared.sort((x, y) => x.cost - y.cost || compareNames(view, x.entity, y.entity))
}

function compareNames(view: TrailView, a: number, b: number): number {
  return view.index.entities[a].name.localeCompare(view.index.entities[b].name)
}

// ---------------------------------------------------------------------------
// A random place to start
// ---------------------------------------------------------------------------

/** How many of a title's entities link anything in this scope. */
export function linkedThreadCount(view: TrailView, title: number): number {
  let linked = 0
  for (const entity of view.index.titleEntities[title]) if (view.links(entity)) linked += 1
  return linked
}

/** Linking entities a random start should have, so Next from here has rows to show for it. */
export const WELL_CONNECTED_THREADS = 4

/**
 * A random title in scope with enough linking entities, or null when a
 * bounded number of draws finds none (a library with almost no credits).
 */
export function pickWellConnected(view: TrailView, random: () => number): number | null {
  const total = view.index.titles.length
  if (total === 0 || view.titleCount === 0) return null
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const title = Math.floor(random() * total)
    if (view.allowed[title] && linkedThreadCount(view, title) >= WELL_CONNECTED_THREADS) return title
  }
  return null
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
