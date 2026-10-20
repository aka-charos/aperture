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
  parseEntityKinds,
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
  createView,
  describeIndex,
  pickWellConnected,
  sharedLinks,
  titleThread,
  titleThreads,
  walkTrail,
  weightedPick,
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

test('two titles share their rarest link first: Heat and L.A. Confidential through Spinotti, then the studio', () => {
  const { index, at, heat, confidential } = library()
  const view = createView(index, null)
  const shared = sharedLinks(view, at(heat), at(confidential))
  assert.deepEqual(
    shared.map((link) => index.entities[link.entity].name),
    ['Dante Spinotti', 'Warner Bros.']
  )
  // A step costs what rules.ts says one does.
  assert.equal(shared[0].cost, stepCost(roleBit('cinematographer'), roleBit('cinematographer'), 3))
})

test('one person in two roles links a film to a show', () => {
  const { index, at, mulholland, peaks } = library()
  const shared = sharedLinks(createView(index, null), at(mulholland), at(peaks))
  assert.equal(shared.length, 1)
  assert.equal(index.entities[shared[0].entity].name, 'David Lynch')
})

test('a title with no shared thing has no threads', () => {
  const { index, at, heat, lonely } = library()
  const view = createView(index, null)
  assert.deepEqual(titleThreads(view, at(lonely)), [])
  assert.deepEqual(sharedLinks(view, at(heat), at(lonely)), [])
})

test('the scope decides both which titles a thread leads to and how rare a link is', () => {
  const { index, at, heat, confidential, dahlia, insider } = library()
  const allowed = [heat, dahlia, insider].map(at)
  const view = createView(index, allowed)
  assert.equal(view.count(entityNamed(index, 'Dante Spinotti')), 2)
  const spinotti = titleThreads(view, at(heat)).find((thread) => index.entities[thread.entity].name === 'Dante Spinotti')
  assert.deepEqual(spinotti?.others.map((member) => member.title), [at(insider)])
  // A title out of scope has no threads at all.
  assert.deepEqual(titleThreads(view, at(confidential)), [])
})

test('a category carried by too many titles links nothing', () => {
  const sources: TitleSource[] = []
  for (let i = 0; i < 40; i += 1) {
    sources.push(title(`Film ${i}`, 2000 + i, i < 30 ? [['keyword', 'based on novel']] : []))
  }
  const index = buildTrailIndex(sources)
  const view = createView(index, null)
  assert.equal(view.links(entityNamed(index, 'based on novel')), false)
  assert.deepEqual(titleThreads(view, 0), [])
})

test('every entity has a stable key the index finds it by', () => {
  const { index } = library()
  const spinotti = entityNamed(index, 'Dante Spinotti')
  assert.equal(index.entities[spinotti].key, 'person:dante spinotti')
  assert.equal(index.byKey.get('person:dante spinotti'), spinotti)
  // A rebuild of the same library gives the same keys.
  assert.equal(library().index.entities[spinotti].key, index.entities[spinotti].key)
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

test('hiding watched titles leaves a thread\'s rarity alone and drops a thread that leads only to them', () => {
  const { index, at, heat, insider, collateral, confidential } = library()
  const view = createView(index, null)
  const exclude = new Uint8Array(index.titles.length)
  exclude[at(insider)] = 1
  exclude[at(confidential)] = 1
  const threads = titleThreads(view, at(heat), { exclude })
  const names = threads.map((thread) => index.entities[thread.entity].name)
  // Spinotti and Pacino lead only to watched titles now; Mann still leads to Collateral.
  assert.ok(!names.includes('Dante Spinotti'))
  assert.ok(!names.includes('Al Pacino'))
  const mann = threads.find((thread) => index.entities[thread.entity].name === 'Michael Mann')
  assert.deepEqual(mann?.others.map((member) => member.title), [at(collateral)])
  assert.equal(mann?.count, 3)
})

test('a kind filter keeps only threads of those kinds', () => {
  const { index, at, heat } = library()
  const threads = titleThreads(createView(index, null), at(heat), { kinds: new Set(['company'] as const) })
  assert.deepEqual(threads.map((thread) => index.entities[thread.entity].name), ['Warner Bros.'])
})

test('a thread opened on its own lists every title it leads to', () => {
  const { index, at, heat, insider, collateral } = library()
  const view = createView(index, null)
  const mann = entityNamed(index, 'Michael Mann')
  const opened = titleThread(view, at(heat), mann)
  assert.deepEqual(opened?.others.map((member) => member.title), [at(insider), at(collateral)])
  assert.equal(opened?.more, 0)
  // A title not carrying it, and an entity that links nothing, open nothing.
  assert.equal(titleThread(view, at(collateral), entityNamed(index, 'Dante Spinotti')), null)
})

test('a walk follows a strong thread to a new title each step, and never follows one thing twice', () => {
  const { index, at, heat, insider } = library()
  const view = createView(index, null)
  // random() = 0 always takes the strongest choice.
  const walked = walkTrail(view, at(heat), { random: () => 0 })
  assert.ok(walked.length > 0)
  const titles = [at(heat), ...walked.map((step) => step.to)]
  assert.equal(new Set(titles).size, titles.length)
  const entities = walked.map((step) => step.entity)
  assert.equal(new Set(entities).size, entities.length)
  walked.forEach((step, i) => {
    assert.equal(step.from, titles[i])
    assert.ok(sharedLinks(view, step.from, step.to).some((link) => link.entity === step.entity))
  })
  // The first step takes Heat's strongest thread, to that thread's strongest title.
  const strongest = titleThreads(view, at(heat))[0]
  assert.equal(walked[0].entity, strongest.entity)
  assert.equal(index.entities[strongest.entity].name, 'Al Pacino')
  assert.equal(walked[0].to, at(insider))
})

test('a walk avoids excluded and already-visited titles and stops where nothing is left', () => {
  const { index, at, heat, lonely } = library()
  const view = createView(index, null)
  const exclude = new Uint8Array(index.titles.length).fill(1)
  exclude[at(heat)] = 0
  assert.deepEqual(walkTrail(view, at(heat), { random: () => 0, exclude }), [])
  assert.deepEqual(walkTrail(view, at(lonely), { random: () => 0 }), [])
  const visited = titleThreads(view, at(heat)).flatMap((thread) => thread.others.map((member) => member.title))
  assert.deepEqual(walkTrail(view, at(heat), { random: () => 0, visited }), [])
})

test('a weighted pick favours the first choice and covers them all', () => {
  assert.equal(weightedPick(3, () => 0), 0)
  assert.equal(weightedPick(3, () => 0.49), 0)
  assert.equal(weightedPick(3, () => 0.51), 1)
  assert.equal(weightedPick(3, () => 0.99), 2)
  assert.equal(weightedPick(1, () => 0.99), 0)
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

test('a summary with no members counts what a full thread would list, without listing it', () => {
  const { index, at, heat, insider } = library()
  const view = createView(index, null)
  const exclude = new Uint8Array(index.titles.length)
  exclude[at(insider)] = 1
  for (const options of [{}, { exclude }]) {
    const full = titleThreads(view, at(heat), options)
    const summary = titleThreads(view, at(heat), { ...options, perThread: 0 })
    assert.deepEqual(
      summary.map((thread) => [thread.entity, thread.others.length, thread.more]),
      full.map((thread) => [thread.entity, 0, thread.others.length + thread.more])
    )
  }
})

test('a random start honours the kinds and the watched titles the page hides', () => {
  const { index, at, heat, confidential, insider, collateral } = library()
  const view = createView(index, null)
  // Only Heat and L.A. Confidential carry a company that links (Warner Bros.).
  const companies = new Set(['company'] as const)
  let seed = 0
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 20; i += 1) {
    const picked = pickWellConnected(view, random, { kinds: companies })
    assert.ok(picked === at(heat) || picked === at(confidential))
  }
  // With L.A. Confidential watched, Heat's studio leads nowhere, and so does Confidential's.
  const exclude = new Uint8Array(index.titles.length)
  exclude[at(confidential)] = 1
  exclude[at(heat)] = 1
  assert.equal(pickWellConnected(view, random, { kinds: companies, exclude }), null)
  // A watched title is never the start either.
  exclude.fill(0)
  exclude[at(insider)] = 1
  exclude[at(collateral)] = 1
  for (let i = 0; i < 20; i += 1) {
    const picked = pickWellConnected(view, random, { exclude })
    assert.ok(picked !== at(insider) && picked !== at(collateral))
  }
})

test('kinds from a request: unknown ones dropped, repeats once, none means every kind', () => {
  assert.deepEqual(parseEntityKinds('keyword,nonsense,person,keyword'), ['keyword', 'person'])
  assert.equal(parseEntityKinds('nonsense'), null)
  assert.equal(parseEntityKinds(''), null)
  assert.equal(parseEntityKinds(undefined), null)
})
