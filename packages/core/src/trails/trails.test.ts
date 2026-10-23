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
  createView,
  describeIndex,
  pickWellConnected,
  sharedLinks,
  linkedThreadCount,
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

test('a title with no shared thing links nothing', () => {
  const { index, at, heat, lonely } = library()
  const view = createView(index, null)
  assert.equal(linkedThreadCount(view, at(lonely)), 0)
  assert.deepEqual(sharedLinks(view, at(heat), at(lonely)), [])
})

test('the scope decides both what a title links to and how rare a link is', () => {
  const { index, at, heat, dahlia, insider } = library()
  const allowed = [heat, dahlia, insider].map(at)
  const view = createView(index, allowed)
  assert.equal(view.count(entityNamed(index, 'Dante Spinotti')), 2)
  assert.deepEqual(
    sharedLinks(view, at(heat), at(insider)).map((link) => index.entities[link.entity].name).includes('Dante Spinotti'),
    true
  )
  // L.A. Confidential is out of scope, so Heat's studio reaches only itself and links nothing.
  assert.equal(view.links(entityNamed(index, 'Warner Bros.')), false)
})

test('a category carried by too many titles links nothing', () => {
  const sources: TitleSource[] = []
  for (let i = 0; i < 40; i += 1) {
    sources.push(title(`Film ${i}`, 2000 + i, i < 30 ? [['keyword', 'based on novel']] : []))
  }
  const index = buildTrailIndex(sources)
  const view = createView(index, null)
  assert.equal(view.links(entityNamed(index, 'based on novel')), false)
  assert.equal(linkedThreadCount(view, 0), 0)
})

test('every entity has a stable key the index finds it by', () => {
  const { index } = library()
  const spinotti = entityNamed(index, 'Dante Spinotti')
  assert.equal(index.entities[spinotti].key, 'person:dante spinotti')
  assert.equal(index.byKey.get('person:dante spinotti'), spinotti)
  // A rebuild of the same library gives the same keys.
  assert.equal(library().index.entities[spinotti].key, index.entities[spinotti].key)
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

test('a random start is a title with enough links to show rows for', () => {
  const { index, at, heat } = library()
  const view = createView(index, null)
  let seed = 0
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  // Only Heat links four things (Mann, Spinotti, Pacino, Warner Bros.).
  for (let i = 0; i < 20; i += 1) assert.equal(pickWellConnected(view, random), at(heat))
  assert.equal(pickWellConnected(createView(index, [at(heat)]), random), null)
})
