import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOP_COST,
  LEAD_BILLING,
  MAX_BILLED_ACTORS,
  entityLinks,
  linkCap,
  maskCost,
  normalizeName,
  parseTitleRef,
  rarity,
  roleBit,
  rolesOf,
  stepCost,
  threadCost,
  type LinkRole,
} from './rules.js'
import {
  buildTrailIndex,
  commonGround,
  createView,
  describeIndex,
  findPath,
  findPaths,
  pickDistantTitle,
  sharedLinks,
  titleThreads,
  type TrailIndex,
  type CreditSource,
  type TitleSource,
} from './graph.js'
import { actorCredits, movieSource, seriesSource, studioCredits } from './sources.js'

let counter = 0
function uuid(): string {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

function title(name: string, year: number, credits: Array<[LinkRole, string]>, type: 'movie' | 'series' = 'movie'): TitleSource {
  return {
    type,
    id: uuid(),
    title: name,
    year,
    posterUrl: null,
    credits: credits.map(([role, creditName]): CreditSource => ({ role, name: creditName })),
  }
}

/** A small library where Heat reaches The Black Dahlia only through L.A. Confidential. */
function library() {
  const heat = title('Heat', 1995, [
    ['director', 'Michael Mann'],
    ['cinematographer', 'Dante Spinotti'],
    ['lead', 'Al Pacino'],
    ['lead', 'Robert De Niro'],
    ['studio', 'Warner Bros.'],
  ])
  const confidential = title('L.A. Confidential', 1997, [
    ['cinematographer', 'Dante Spinotti'],
    ['writer', 'James Ellroy'],
    ['lead', 'Kevin Spacey'],
    ['studio', 'Warner Bros.'],
  ])
  const dahlia = title('The Black Dahlia', 2006, [
    ['writer', 'James Ellroy'],
    ['director', 'Brian De Palma'],
  ])
  const insider = title('The Insider', 1999, [
    ['director', 'Michael Mann'],
    ['cinematographer', 'Dante Spinotti'],
    ['lead', 'Al Pacino'],
  ])
  const collateral = title('Collateral', 2004, [['director', 'Michael Mann']])
  const lonely = title('Lonely', 2010, [['director', 'Nobody Else']])
  const mulholland = title('Mulholland Drive', 2001, [['director', 'David Lynch'], ['writer', 'David Lynch']])
  const peaks = title('Twin Peaks', 1990, [['creator', 'David Lynch'], ['network', 'ABC']], 'series')
  const sources = [heat, confidential, dahlia, insider, collateral, lonely, mulholland, peaks]
  const index = buildTrailIndex(sources)
  const at = (source: TitleSource) => index.byRef.get(`${source.type}:${source.id}`) as number
  return { index, at, heat, confidential, dahlia, insider, collateral, lonely, mulholland, peaks }
}

function entityNamed(index: TrailIndex, name: string): number {
  return index.entities.findIndex((entity) => entity.name === name)
}

test('a role mask reads back strongest first, and costs its strongest role', () => {
  const mask = roleBit('writer') | roleBit('director')
  assert.deepEqual(rolesOf(mask), ['director', 'writer'])
  assert.equal(maskCost(mask), 1)
  assert.equal(maskCost(0), Number.POSITIVE_INFINITY)
})

test('a step costs the same read either way, and a rarer link is cheaper', () => {
  const a = roleBit('lead')
  const b = roleBit('director')
  assert.equal(stepCost(a, b, 4), stepCost(b, a, 4))
  assert.ok(stepCost(a, b, 2) < stepCost(a, b, 3))
  // Two titles sharing a thing pay its base weight once, plus the step.
  assert.equal(stepCost(b, b, 2), HOP_COST + 1)
  assert.equal(threadCost(b, 4), 2)
  assert.equal(rarity(1), 1)
})

test('the cap scales with the library between a floor and a ceiling; franchises are never capped', () => {
  assert.equal(linkCap('keyword', 40), 8)
  assert.equal(linkCap('person', 5_000), 100)
  assert.equal(linkCap('person', 100_000), 150)
  assert.equal(linkCap('franchise', 10), Number.POSITIVE_INFINITY)
  assert.equal(entityLinks('keyword', 1, 1_000), false)
  assert.equal(entityLinks('keyword', 9, 40), false)
  assert.equal(entityLinks('franchise', 60, 40), true)
})

test('names fold case and spacing but keep accents', () => {
  assert.equal(normalizeName('  Dante   SPINOTTI '), 'dante spinotti')
  assert.notEqual(normalizeName('José'), normalizeName('Jose'))
})

test('a title ref is a type and a uuid, lowercased', () => {
  assert.deepEqual(parseTitleRef('movie:00000000-0000-4000-8000-00000000000A'), {
    type: 'movie',
    id: '00000000-0000-4000-8000-00000000000a',
  })
  assert.equal(parseTitleRef('movie:42'), null)
  assert.equal(parseTitleRef('episode:00000000-0000-4000-8000-000000000001'), null)
  assert.equal(parseTitleRef(undefined), null)
})

test('the index keeps only what two titles share, merges one person\'s roles, and ignores a repeated title', () => {
  const { index, at, mulholland, heat } = library()
  assert.equal(entityNamed(index, 'Kevin Spacey'), -1)
  assert.equal(entityNamed(index, 'Nobody Else'), -1)
  const lynch = entityNamed(index, 'David Lynch')
  const position = Array.from(index.titleEntities[at(mulholland)]).indexOf(lynch)
  assert.deepEqual(rolesOf(index.titleMasks[at(mulholland)][position]), ['director', 'writer'])
  const again = buildTrailIndex([heat, heat])
  assert.equal(again.titles.length, 1)
})

test('a path names the rare link: Heat reaches The Black Dahlia through Spinotti, then Ellroy', () => {
  const { index, at, heat, confidential, dahlia } = library()
  const view = createView(index, null)
  const path = findPath(view, at(heat), at(dahlia))
  assert.ok(path)
  assert.deepEqual(path.titles, [at(heat), at(confidential), at(dahlia)])
  assert.deepEqual(
    path.entities.map((entity) => index.entities[entity].name),
    ['Dante Spinotti', 'James Ellroy']
  )
  // The cost is the sum of its steps, as rules.ts defines one.
  const expected =
    stepCost(roleBit('cinematographer'), roleBit('cinematographer'), 3) +
    stepCost(roleBit('writer'), roleBit('writer'), 2)
  assert.ok(Math.abs(path.cost - expected) < 1e-9)
  // The studio both share is offered beside the step, not instead of it.
  const shared = sharedLinks(view, at(heat), at(confidential)).map((link) => index.entities[link.entity].name)
  assert.deepEqual(shared, ['Dante Spinotti', 'Warner Bros.'])
})

test('one person in two roles links a film to a show', () => {
  const { index, at, mulholland, peaks } = library()
  const path = findPath(createView(index, null), at(mulholland), at(peaks))
  assert.ok(path)
  assert.equal(path.titles.length, 2)
  assert.equal(index.entities[path.entities[0]].name, 'David Lynch')
})

test('a title with no shared thing has no path', () => {
  const { index, at, heat, lonely } = library()
  assert.equal(findPath(createView(index, null), at(heat), at(lonely)), null)
  assert.equal(findPath(createView(index, null), at(heat), at(heat)), null)
})

test('the scope decides both which titles a path may use and how rare a link is', () => {
  const { index, at, heat, confidential, dahlia, insider } = library()
  const allowed = [heat, dahlia, insider].map(at)
  const view = createView(index, allowed)
  assert.equal(findPath(view, at(heat), at(dahlia)), null)
  assert.equal(view.count(entityNamed(index, 'Dante Spinotti')), 2)
  // A title out of scope cannot be an end either.
  assert.equal(findPath(view, at(heat), at(confidential)), null)
})

test('a category carried by too many titles links nothing', () => {
  const sources: TitleSource[] = []
  for (let i = 0; i < 40; i += 1) {
    sources.push(title(`Film ${i}`, 2000 + i, i < 30 ? [['keyword', 'based on novel']] : []))
  }
  const index = buildTrailIndex(sources)
  const view = createView(index, null)
  assert.equal(view.links(entityNamed(index, 'based on novel')), false)
  assert.equal(findPath(view, 0, 1), null)
})

test('alternative routes go through different titles', () => {
  const hub = title('Start', 2000, [['director', 'A'], ['director', 'B'], ['director', 'C']])
  const viaA = title('Via A', 2001, [['director', 'A'], ['writer', 'X']])
  const viaB = title('Via B', 2002, [['director', 'B'], ['writer', 'Y']])
  const viaC = title('Via C', 2003, [['director', 'C'], ['writer', 'Z']])
  const end = title('End', 2004, [['writer', 'X'], ['writer', 'Y'], ['writer', 'Z']])
  const index = buildTrailIndex([hub, viaA, viaB, viaC, end])
  const paths = findPaths(createView(index, null), 0, 4)
  assert.equal(paths.length, 3)
  const middles = paths.map((path) => path.titles[1])
  assert.equal(new Set(middles).size, 3)
  assert.ok(paths[0].cost <= paths[1].cost && paths[1].cost <= paths[2].cost)
})

test('a direct link is one route; what else the two share rides beside it', () => {
  const { index, at, heat, insider } = library()
  const paths = findPaths(createView(index, null), at(heat), at(insider))
  assert.equal(paths.length, 1)
  assert.equal(paths[0].titles.length, 2)
})

test('threads leave out the starting title, list members oldest first and count the rest', () => {
  const { index, at, heat, insider, collateral } = library()
  const view = createView(index, null)
  const threads = titleThreads(view, at(heat), { perThread: 1 })
  const mann = threads.find((thread) => index.entities[thread.entity].name === 'Michael Mann')
  assert.ok(mann)
  assert.equal(mann.count, 3)
  assert.equal(mann.others.length, 1)
  assert.equal(mann.more, 1)
  const full = titleThreads(view, at(heat)).find((thread) => thread.entity === mann.entity)
  assert.deepEqual(full?.others.map((member) => member.title), [at(insider), at(collateral)])
  // Strongest first, by the cost rules.ts gives a thread.
  const costs = threads.map((thread) => thread.cost)
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b))
})

test('in common: what more of the chosen titles share comes first', () => {
  const { index, at, heat, insider, collateral } = library()
  const links = commonGround(createView(index, null), [at(heat), at(insider), at(collateral)])
  assert.equal(index.entities[links[0].entity].name, 'Michael Mann')
  assert.equal(links[0].carriers.length, 3)
  assert.ok(links.every((link) => link.carriers.length >= 2))
})

test('a surprise target is at least the asked number of steps away', () => {
  const { index, at, heat, dahlia } = library()
  const view = createView(index, null)
  const target = pickDistantTitle(view, at(heat), () => 0, 2, 3)
  assert.equal(target, at(dahlia))
  assert.equal(pickDistantTitle(view, at(heat), () => 0, 5, 6), null)
})

test('the description counts isolated titles and capped entities', () => {
  const { index } = library()
  const description = describeIndex(createView(index, null))
  assert.equal(description.titles, 8)
  assert.equal(description.isolatedTitles, 1)
  assert.equal(description.linkingEntities.person, 5)
  assert.equal(description.linkingEntities.company, 1)
})

test('billed actors: the first three are leads, unnamed entries use no slot, and the list is capped', () => {
  const actors = [
    { name: 'One', thumb: 'http://x/1' },
    { name: '' },
    { name: 'Two' },
    { name: 'Three' },
    ...Array.from({ length: 20 }, (_, i) => ({ name: `Extra ${i}` })),
  ]
  const credits = actorCredits(actors)
  assert.equal(credits.length, MAX_BILLED_ACTORS)
  assert.deepEqual(credits.slice(0, LEAD_BILLING + 1).map((credit) => credit.role), ['lead', 'lead', 'lead', 'actor'])
  assert.equal(credits[0].photo, 'http://x/1')
  assert.equal(credits[1].photo, null)
  assert.deepEqual(actorCredits(null), [])
  assert.deepEqual(studioCredits([{ name: 'A24' }, { id: 3 }, 'x']), [{ role: 'studio', name: 'A24' }])
})

test('a franchise is keyed by its collection id, so two collections sharing a name stay two', () => {
  const base = {
    year: 2000,
    poster_url: null,
    directors: null,
    writers: null,
    cinematographers: null,
    composers: null,
    editors: null,
    actors: [],
    keywords: null,
    studios: [],
  }
  const rows = [
    { ...base, id: uuid(), title: 'A1', collection_id: '1', collection_name: 'Trilogy' },
    { ...base, id: uuid(), title: 'A2', collection_id: '1', collection_name: 'Trilogy' },
    { ...base, id: uuid(), title: 'B1', collection_id: '2', collection_name: 'Trilogy' },
    { ...base, id: uuid(), title: 'B2', collection_id: '2', collection_name: 'Trilogy' },
  ]
  const index = buildTrailIndex(rows.map(movieSource))
  assert.equal(index.entities.filter((entity) => entity.kind === 'franchise').length, 2)
})

test('a show credits its creators and its network', () => {
  const source = seriesSource({
    id: uuid(),
    title: 'Show',
    year: 2010,
    poster_url: null,
    creators: ['Vince Gilligan'],
    writers: [],
    actors: [],
    keywords: [],
    studios: [{ name: 'Sony' }],
    network: 'AMC',
  })
  assert.deepEqual(
    source.credits.map((credit) => [credit.role, credit.name]),
    [
      ['creator', 'Vince Gilligan'],
      ['studio', 'Sony'],
      ['network', 'AMC'],
    ]
  )
})

/** Plain one-ended Dijkstra over the same costs, to check the two-ended search against. */
function referenceCost(index: TrailIndex, from: number, to: number): number | null {
  const view = createView(index, null)
  const dist = new Map<number, number>([[from, 0]])
  const done = new Set<number>()
  for (;;) {
    let node = -1
    let best = Number.POSITIVE_INFINITY
    for (const [title, cost] of dist) {
      if (!done.has(title) && cost < best) {
        best = cost
        node = title
      }
    }
    if (node < 0) return null
    if (node === to) return best
    done.add(node)
    for (const link of index.titleEntities[node]) {
      if (!view.links(link)) continue
      for (const other of index.entities[link].titles) {
        if (other === node) continue
        const shared = sharedLinks(view, node, other).find((entry) => entry.entity === link)
        if (!shared) continue
        const cost = best + shared.cost
        if (cost < (dist.get(other) ?? Number.POSITIVE_INFINITY)) dist.set(other, cost)
      }
    }
  }
}

test('the two-ended search finds the cheapest path, on random libraries', () => {
  let seed = 11
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const roles: LinkRole[] = ['director', 'writer', 'lead', 'actor', 'keyword', 'studio', 'composer']
  for (let round = 0; round < 25; round += 1) {
    const sources: TitleSource[] = []
    for (let i = 0; i < 30; i += 1) {
      const credits: Array<[LinkRole, string]> = []
      for (let k = 0; k < 3; k += 1) {
        const role = roles[Math.floor(random() * roles.length)]
        credits.push([role, `P${Math.floor(random() * 25)}`])
      }
      sources.push(title(`R${round}-${i}`, 2000, credits))
    }
    const index = buildTrailIndex(sources)
    const view = createView(index, null)
    for (let pair = 0; pair < 6; pair += 1) {
      const from = Math.floor(random() * 30)
      const to = Math.floor(random() * 30)
      if (from === to) continue
      const found = findPath(view, from, to, { maxHops: 30 })
      const expected = referenceCost(index, from, to)
      if (expected == null) {
        assert.equal(found, null)
        continue
      }
      assert.ok(found, `round ${round}: ${from} → ${to} has a path`)
      assert.ok(Math.abs(found.cost - expected) < 1e-9, `round ${round}: ${found.cost} vs ${expected}`)
      // The path it names really costs what it says.
      let walked = 0
      for (let step = 0; step < found.entities.length; step += 1) {
        const shared = sharedLinks(view, found.titles[step], found.titles[step + 1])
        const link = shared.find((entry) => entry.entity === found.entities[step])
        assert.ok(link)
        walked += link.cost
      }
      assert.ok(Math.abs(walked - found.cost) < 1e-9)
      assert.equal(found.titles[0], from)
      assert.equal(found.titles[found.titles.length - 1], to)
    }
  }
})

test('production meta-keywords are not links, whatever their casing', () => {
  const source = seriesSource({
    id: uuid(),
    title: 'Show',
    year: 2010,
    poster_url: null,
    creators: [],
    writers: [],
    actors: [],
    keywords: ['DuringCreditsStinger', 'woman director', 'heist', 'Sequel'],
    studios: [],
    network: null,
  })
  assert.deepEqual(
    source.credits.map((credit) => credit.name),
    ['heist']
  )
})

test('a route inside the step limit is found even when a cheaper one needs more steps', () => {
  // A–B–M and M–C–D are cheap franchise steps; A–M and M–D are dear studio
  // steps. The cheapest A→D route takes four steps; with a limit of two only
  // A–M–D fits, and with one label per node the cheap long prefixes claimed M
  // from both ends and hid it.
  const a = title('A', 2000, [['franchise', 'F1'], ['studio', 'S1']])
  const b = title('B', 2001, [['franchise', 'F1'], ['franchise', 'F1b']])
  const m = title('M', 2002, [['franchise', 'F1b'], ['franchise', 'F2b'], ['studio', 'S1'], ['studio', 'S2']])
  const c = title('C', 2003, [['franchise', 'F2b'], ['franchise', 'F2']])
  const d = title('D', 2004, [['franchise', 'F2'], ['studio', 'S2']])
  const index = buildTrailIndex([a, b, m, c, d])
  const at = (source: TitleSource) => index.byRef.get(`${source.type}:${source.id}`) as number
  const view = createView(index, null)
  const short = findPath(view, at(a), at(d), { maxHops: 2 })
  assert.ok(short)
  assert.deepEqual(short.titles, [at(a), at(m), at(d)])
  const unlimited = findPath(view, at(a), at(d), { maxHops: 8 })
  assert.equal(unlimited?.titles.length, 5)
  assert.ok((unlimited?.cost ?? 0) < short.cost)
})

/** The cheapest route of at most `maxHops` steps, by dynamic programming over step counts. */
function referenceLimitedCost(index: TrailIndex, from: number, to: number, maxHops: number): number | null {
  const view = createView(index, null)
  const count = index.titles.length
  let layer = new Map<number, number>([[from, 0]])
  let best = Number.POSITIVE_INFINITY
  for (let step = 1; step <= maxHops; step += 1) {
    const next = new Map<number, number>()
    for (const [title, cost] of layer) {
      for (let other = 0; other < count; other += 1) {
        if (other === title) continue
        const shared = sharedLinks(view, title, other)
        if (shared.length === 0) continue
        const total = cost + shared[0].cost
        if (total < (next.get(other) ?? Number.POSITIVE_INFINITY)) next.set(other, total)
      }
    }
    const reached = next.get(to)
    if (reached != null && reached < best) best = reached
    layer = next
  }
  return Number.isFinite(best) ? best : null
}

test('with a step limit, the two-ended search still finds the cheapest route that fits', () => {
  let seed = 23
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const roles: LinkRole[] = ['director', 'writer', 'lead', 'actor', 'keyword', 'studio', 'franchise']
  for (let round = 0; round < 30; round += 1) {
    const sources: TitleSource[] = []
    for (let i = 0; i < 18; i += 1) {
      const credits: Array<[LinkRole, string]> = []
      for (let k = 0; k < 2; k += 1) {
        credits.push([roles[Math.floor(random() * roles.length)], `Q${Math.floor(random() * 14)}`])
      }
      sources.push(title(`L${round}-${i}`, 2000, credits))
    }
    const index = buildTrailIndex(sources)
    const view = createView(index, null)
    for (let pair = 0; pair < 5; pair += 1) {
      const from = Math.floor(random() * 18)
      const to = Math.floor(random() * 18)
      if (from === to) continue
      const maxHops = 1 + Math.floor(random() * 3)
      const found = findPath(view, from, to, { maxHops })
      const expected = referenceLimitedCost(index, from, to, maxHops)
      if (expected == null) {
        assert.equal(found, null, `round ${round}: ${from} → ${to} within ${maxHops}`)
        continue
      }
      assert.ok(found, `round ${round}: ${from} → ${to} within ${maxHops} exists`)
      assert.ok(found.entities.length <= maxHops)
      assert.ok(Math.abs(found.cost - expected) < 1e-9, `round ${round}: ${found.cost} vs ${expected}`)
    }
  }
})
