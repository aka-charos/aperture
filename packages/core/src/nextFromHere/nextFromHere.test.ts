import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrailIndex, createView, type CreditSource, type TitleSource, type TrailView } from '../trails/graph.js'
import { roleBit, formatTitleRef } from '../trails/rules.js'
import { LINKED_PER_ENTITY } from './rules.js'
import {
  CLOSE_ITEMS,
  PEOPLE_ROWS,
  ROW_MEMBERS,
  THEMES_SHOWN,
  closenessFromRank,
  sharedRoleStrength,
  titleWeight,
} from './rules.js'
import {
  companyAffinity,
  companyBase,
  personAffinity,
  pickClose,
  scoreCandidates,
  type Candidate,
  type ViewerTitle,
} from './taste.js'
import { peopleRows } from './people.js'
import { mapLinks } from './map.js'

let counter = 0
function uuid(): string {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

function title(name: string, credits: CreditSource[], type: 'movie' | 'series' = 'movie'): TitleSource {
  return { type, id: uuid(), title: name, year: 2000, posterUrl: null, credits }
}

const director = (name: string): CreditSource => ({ role: 'director', name })
const lead = (name: string): CreditSource => ({ role: 'lead', name })
const actor = (name: string): CreditSource => ({ role: 'actor', name })
const editor = (name: string): CreditSource => ({ role: 'editor', name })
const network = (name: string): CreditSource => ({ role: 'network', name })
const studio = (name: string): CreditSource => ({ role: 'studio', name })
const keyword = (name: string): CreditSource => ({ role: 'keyword', name })
const writer = (name: string): CreditSource => ({ role: 'writer', name })

function build(sources: TitleSource[]): { view: TrailView; at: (s: TitleSource) => number; entity: (key: string) => number } {
  const index = buildTrailIndex(sources)
  const view = createView(index, null)
  return {
    view,
    at: (s) => index.byRef.get(formatTitleRef(s))!,
    entity: (key) => index.byKey.get(key)!,
  }
}

const liked = (rating: number | null, finished = true): ViewerTitle => ({
  weight: titleWeight({ rating, finished }),
  rating,
  finished,
})

test('a rating decides a title weight alone; finishing unrated is a mild yes; dropping says nothing', () => {
  assert.equal(titleWeight({ rating: 10, finished: false }), 1)
  assert.equal(titleWeight({ rating: 7, finished: true }), 0.7)
  assert.equal(titleWeight({ rating: 5, finished: true }), 0)
  assert.equal(titleWeight({ rating: 2, finished: true }), -1)
  assert.equal(titleWeight({ rating: null, finished: true }), 0.5)
  assert.equal(titleWeight({ rating: null, finished: false }), 0)
  // Ratings run 1-10 and are monotonic: a higher rating never weighs less.
  let previous = -Infinity
  for (let rating = 1; rating <= 10; rating += 1) {
    const weight = titleWeight({ rating, finished: true })
    assert.ok(weight >= previous, `rating ${rating}`)
    previous = weight
  }
})

test('closeness is a rank, and a franchise is the weakest shared reason', () => {
  assert.equal(closenessFromRank(0, 50), 1)
  assert.equal(closenessFromRank(25, 50), 0.5)
  assert.equal(closenessFromRank(-1, 50), 0)
  assert.equal(closenessFromRank(3, 0), 0)
  assert.ok(sharedRoleStrength(roleBit('director')) > sharedRoleStrength(roleBit('lead')))
  assert.ok(sharedRoleStrength(roleBit('lead')) > sharedRoleStrength(roleBit('franchise')))
  assert.equal(sharedRoleStrength(roleBit('actor')), 0)
  assert.equal(sharedRoleStrength(roleBit('editor')), 0)
})

test('a person counts only when the viewer keeps finishing and liking their titles, in a major role', () => {
  const a = title('A', [director('Hal Hartley'), actor('Bit Part')])
  const b = title('B', [director('Hal Hartley'), actor('Bit Part')])
  const c = title('C', [director('Hal Hartley'), actor('Bit Part')])
  const d = title('D', [lead('Mixed Lead')])
  const e = title('E', [lead('Mixed Lead')])
  const { view, at, entity } = build([a, b, c, d, e])
  const record = new Map<number, ViewerTitle>([
    [at(a), liked(9)],
    [at(b), liked(8)],
    [at(c), liked(null)],
    [at(d), liked(9)],
    [at(e), liked(2)],
  ])
  const hartley = personAffinity(view, entity('person:hal hartley'), record)
  assert.ok(hartley)
  assert.equal(hartley.liked, 3)
  assert.equal(hartley.averageRating, 8.5)
  assert.ok(hartley.score > 0 && hartley.score <= 1)
  // An actor credit (a bit part) never makes anyone a favourite, however often.
  assert.equal(personAffinity(view, entity('person:bit part'), record), null)
  // One liked and one hated title is not "you keep coming back".
  assert.equal(personAffinity(view, entity('person:mixed lead'), record), null)
  // One liked title is not enough either.
  const once = new Map<number, ViewerTitle>([[at(a), liked(10)]])
  assert.equal(personAffinity(view, entity('person:hal hartley'), once), null)
})

test('a network counts by skew: finishing far more of it than its library share, never by volume', () => {
  const sources: TitleSource[] = []
  for (let i = 0; i < 4; i += 1) sources.push(title(`Niche ${i}`, [network('Niche Net')], 'series'))
  for (let i = 0; i < 40; i += 1) sources.push(title(`Big ${i}`, [network('Big Net')], 'series'))
  const { view, at, entity } = build(sources)
  const record = new Map<number, ViewerTitle>()
  // Finished 3 of 4 niche shows and 4 of 40 big ones: big is where most of the
  // viewing is, and still below its share.
  for (let i = 0; i < 3; i += 1) record.set(at(sources[i]), liked(null))
  for (let i = 4; i < 8; i += 1) record.set(at(sources[i]), liked(null))
  const base = companyBase(view, record)
  assert.deepEqual(base.finishedByType, { movie: 0, series: 7 })
  const niche = companyAffinity(view, entity('company:niche net'), 'series', record, base)
  assert.ok(niche)
  assert.equal(niche.finished, 3)
  assert.ok(niche.ratio > 3)
  assert.equal(companyAffinity(view, entity('company:big net'), 'series', record, base), null)
  // A disliked finished show does not count toward a company.
  const disliked = new Map(record)
  for (let i = 0; i < 3; i += 1) disliked.set(at(sources[i]), liked(2))
  assert.equal(
    companyAffinity(view, entity('company:niche net'), 'series', disliked, companyBase(view, disliked)),
    null
  )
})

test('candidates: neighbours are close, shared people in a different feel are the other side, watched never appear', () => {
  const start = title('Trust', [director('Hal Hartley'), lead('Adrienne Shelly'), editor('Nick Gomez'), studio('Big Studio')])
  const near = title('Near', [studio('Big Studio')])
  const nearLinked = title('Simple Men', [director('Hal Hartley')])
  const farLinked = title('Henry Fool', [director('Hal Hartley')])
  const editorOnly = title('Editor Only', [editor('Nick Gomez')])
  const watched = title('Amateur', [director('Hal Hartley')])
  const bitPart = title('Cameo', [actor('Adrienne Shelly')])
  const { view, at } = build([start, near, nearLinked, farLinked, editorOnly, watched, bitPart, title('X', [studio('Big Studio')])])
  const record = new Map<number, ViewerTitle>([[at(watched), liked(9)]])
  const candidates = scoreCandidates({
    view,
    start: at(start),
    neighbours: [at(watched), at(near), at(nearLinked)],
    record,
    exclude: (t) => record.has(t),
  })
  const byTitle = new Map(candidates.map((c) => [view.index.titles[c.title].title, c]))
  assert.equal(byTitle.has('Amateur'), false)
  assert.equal(byTitle.has('Trust'), false)
  // An editor and a bit part link nothing here.
  assert.equal(byTitle.has('Editor Only'), false)
  assert.equal(byTitle.has('Cameo'), false)
  assert.equal(byTitle.get('Near')?.quadrant, 'close')
  assert.equal(byTitle.get('Simple Men')?.quadrant, 'closeLinked')
  assert.equal(byTitle.get('Henry Fool')?.quadrant, 'linkedDifferent')
  // The rank shown is 1-based and counts the watched neighbour that was left out.
  assert.deepEqual(byTitle.get('Near')?.reasons[0], { kind: 'feel', rank: 2 })
  const shared = byTitle.get('Henry Fool')?.reasons.find((r) => r.kind === 'shared')
  assert.ok(shared && shared.kind === 'shared')
  // Close and linked beats close alone.
  assert.ok(byTitle.get('Simple Men')!.score > byTitle.get('Near')!.score)
})

test('a favourite person on a candidate becomes a reason, and the same person is not named twice', () => {
  const start = title('Start', [director('Someone Else')])
  const pastA = title('Past A', [director('Kelly Reichardt')])
  const pastB = title('Past B', [director('Kelly Reichardt')])
  const candidate = title('Next', [director('Kelly Reichardt')])
  const sharedFav = title('Shared Fav', [director('Someone Else')])
  const pastC = title('Past C', [director('Someone Else')])
  const pastD = title('Past D', [director('Someone Else')])
  const { view, at } = build([start, pastA, pastB, candidate, sharedFav, pastC, pastD])
  const record = new Map<number, ViewerTitle>([
    [at(pastA), liked(9)],
    [at(pastB), liked(8)],
    [at(pastC), liked(9)],
    [at(pastD), liked(9)],
    [at(start), liked(9)],
  ])
  const candidates = scoreCandidates({
    view,
    start: at(start),
    neighbours: [at(candidate)],
    record,
    exclude: (t) => record.has(t),
  })
  const next = candidates.find((c) => c.title === at(candidate))
  const favourite = next?.reasons.find((r) => r.kind === 'favourite')
  assert.ok(favourite && favourite.kind === 'favourite')
  assert.equal(favourite.liked, 2)
  assert.equal(favourite.averageRating, 8.5)
  const other = candidates.find((c) => c.title === at(sharedFav))
  assert.ok(other)
  assert.equal(other.reasons.filter((r) => r.kind === 'shared').length, 1)
  assert.equal(other.reasons.some((r) => r.kind === 'favourite'), false)
})

test('the close list is the embedding side only, capped', () => {
  const fake = (i: number, quadrant: Candidate['quadrant']): Candidate => ({
    title: i,
    quadrant,
    score: 1 - i / 100,
    reasons: [],
    sharedEntities: [],
  })
  const candidates: Candidate[] = []
  for (let i = 0; i < 10; i += 1) candidates.push(fake(i, 'linkedDifferent'))
  for (let i = 10; i < 40; i += 1) candidates.push(fake(i, i % 2 ? 'close' : 'closeLinked'))
  const close = pickClose(candidates)
  assert.equal(close.length, CLOSE_ITEMS)
  assert.ok(close.every((c) => c.quadrant !== 'linkedDifferent'))
})

test('shared themes are the keywords that still link, rarest first, and say what a close title shares', () => {
  const start = title('Session 9', [
    keyword('asylum'),
    keyword('horror'),
    keyword('abandoned building'),
    keyword('psychiatric hospital'),
    keyword('common'),
  ])
  const near = title('Stonehearst Asylum', [
    keyword('asylum'),
    keyword('horror'),
    keyword('psychiatric hospital'),
    keyword('abandoned building'),
    keyword('common'),
  ])
  const sources = [start, near, title('Other asylum', [keyword('asylum')])]
  // "horror" on five titles, and "common" on twenty-two: past the floor cap
  // of 8, so it links nothing.
  for (let i = 0; i < 3; i += 1) sources.push(title(`Horror ${i}`, [keyword('horror')]))
  for (let i = 0; i < 20; i += 1) sources.push(title(`Common ${i}`, [keyword('common')]))
  sources.push(title('Hospital', [keyword('psychiatric hospital')]))
  const { view, at } = build(sources)
  const [candidate] = scoreCandidates({
    view,
    start: at(start),
    neighbours: [at(near)],
    record: new Map(),
    exclude: () => false,
  })
  const themes = candidate.reasons.find((r) => r.kind === 'themes')
  assert.ok(themes && themes.kind === 'themes')
  assert.equal(themes.entities.length, THEMES_SHOWN)
  // abandoned building (two titles), then asylum and psychiatric hospital
  // (three each, by name); horror (five) is past the three shown.
  assert.deepEqual(
    themes.entities.map((e) => view.index.entities[e].name),
    ['abandoned building', 'asylum', 'psychiatric hospital']
  )
})

test('people rows: major roles only, a favourite first, unseen before seen, the start left out', () => {
  const start = title('Session 9', [
    director('Brad Anderson'),
    lead('David Caruso'),
    actor('Larry Fessenden'),
    writer('Stephen Gevedon'),
    keyword('asylum'),
    { role: 'franchise', name: 'Nine Collection', key: '99' },
  ])
  const machinist = { ...title('The Machinist', [director('Brad Anderson')]), year: 2004 }
  const transsiberian = { ...title('Transsiberian', [director('Brad Anderson')]), year: 2008 }
  const beirut = { ...title('Beirut', [director('Brad Anderson')]), year: 2018 }
  const kingOfNY = title('King of New York', [lead('David Caruso')])
  const twins = title('Twins', [lead('David Caruso')])
  const fessenden = title('Carnage Park', [actor('Larry Fessenden')])
  const gevedon = title('Gevedon solo', [writer('Stephen Gevedon')])
  const sequel = title('Session 10', [{ role: 'franchise', name: 'Nine Collection', key: '99' }])
  const pad = title('Asylum two', [keyword('asylum')])
  const { view, at, entity } = build([
    start,
    machinist,
    transsiberian,
    beirut,
    kingOfNY,
    twins,
    fessenden,
    gevedon,
    sequel,
    pad,
  ])
  // The viewer keeps coming back to David Caruso (both his titles they rated,
  // at 9) and has seen The Machinist.
  const record = new Map<number, ViewerTitle>([
    [at(kingOfNY), liked(9)],
    [at(twins), liked(9)],
    [at(machinist), liked(null)],
  ])
  const rows = peopleRows({
    view,
    start: at(start),
    record,
    seen: (t) => record.has(t),
    scores: new Map([[at(beirut), 0.9]]),
  })
  const names = rows.map((r) => view.index.entities[r.entity].name)
  // A bit part and a keyword open no row.
  assert.equal(names.includes('Larry Fessenden'), false)
  assert.equal(names.includes('asylum'), false)
  // A lead the viewer keeps coming back to outranks the director.
  assert.equal(names[0], 'David Caruso')
  assert.ok(rows[0].person)
  assert.ok(names.indexOf('Brad Anderson') < names.indexOf('Stephen Gevedon'))
  // The franchise is the weakest row.
  assert.equal(names[names.length - 1], 'Nine Collection')
  const anderson = rows.find((r) => r.entity === entity('person:brad anderson'))!
  // Scored unseen first, then unseen by year, then seen.
  assert.deepEqual(
    anderson.members.map((m) => view.index.titles[m.title].title),
    ['Beirut', 'Transsiberian', 'The Machinist']
  )
  assert.deepEqual(
    anderson.members.map((m) => m.seen),
    [false, false, true]
  )
  assert.equal(anderson.total, 3)
  assert.equal(anderson.seenCount, 1)
  assert.ok(rows.every((r) => r.members.every((m) => m.title !== at(start))))
})

test('a company has a row only when the viewer favours it, and rows and members are capped', () => {
  const start = title('Start', [studio('Niche'), studio('Everywhere'), lead('Prolific')])
  const sources: TitleSource[] = [start]
  const niche: TitleSource[] = []
  for (let i = 0; i < 4; i += 1) niche.push(title(`Niche ${i}`, [studio('Niche')]))
  for (let i = 0; i < 40; i += 1) sources.push(title(`Everywhere ${i}`, [studio('Everywhere')]))
  for (let i = 0; i < ROW_MEMBERS + 5; i += 1) sources.push(title(`Prolific ${i}`, [lead('Prolific')]))
  sources.push(...niche)
  const { view, at } = build(sources)
  const record = new Map<number, ViewerTitle>(niche.slice(0, 3).map((s) => [at(s), liked(null)]))
  const rows = peopleRows({ view, start: at(start), record, seen: (t) => record.has(t), scores: new Map() })
  const names = rows.map((r) => view.index.entities[r.entity].name)
  assert.ok(names.includes('Niche'))
  assert.equal(names.includes('Everywhere'), false)
  const prolific = rows.find((r) => view.index.entities[r.entity].name === 'Prolific')!
  assert.equal(prolific.members.length, ROW_MEMBERS)
  assert.equal(prolific.more, 5)
  // Every one of them unseen, so hiding the seen leaves all five out still.
  assert.equal(prolific.moreUnseen, 5)
  assert.ok(rows.length <= PEOPLE_ROWS)
})

test('a row leaves out the trail, and counts only the unseen it could not send', () => {
  const start = title('Start', [director('Prolific')])
  const sources: TitleSource[] = [start]
  for (let i = 0; i < ROW_MEMBERS + 3; i += 1) sources.push(title(`Film ${i}`, [director('Prolific')]))
  const { view, at } = build(sources)
  const earlierStep = at(sources[1])
  // Three seen titles past the unseen: only seen ones fall past the cap.
  const seenTitles = new Set(sources.slice(-3).map(at))
  const [row] = peopleRows({
    view,
    start: at(start),
    record: new Map(),
    seen: (t) => seenTitles.has(t),
    scores: new Map(),
    exclude: (t) => t === earlierStep,
  })
  assert.ok(row.members.every((m) => m.title !== earlierStep))
  assert.equal(row.total, ROW_MEMBERS + 2)
  assert.equal(row.more, 2)
  assert.equal(row.moreUnseen, 0)
})

test('a person past the Trails rarity cap still joins their own titles on the map', () => {
  const sources: TitleSource[] = []
  // Twelve titles: past the floor cap of eight a person links nothing in Trails.
  for (let i = 0; i < 12; i += 1) sources.push(title(`Busy ${i}`, [director('Busy Director')]))
  const { view, at } = build(sources)
  const links = mapLinks(view, [at(sources[0]), at(sources[1])])
  assert.equal(links.length, 1)
  assert.equal(view.index.entities[links[0].entity].name, 'Busy Director')
})

test('the map joins a pair once, by the strongest thing it shares, a person before a theme', () => {
  const a = title('A', [director('Brad Anderson'), keyword('train')])
  const b = title('B', [director('Brad Anderson'), keyword('train')])
  const c = title('C', [keyword('train')])
  const d = title('D', [actor('Bit Part')])
  const e = title('E', [actor('Bit Part')])
  const { view, at } = build([a, b, c, d, e])
  const links = mapLinks(view, [at(a), at(b), at(c), at(d), at(e), at(a)])
  const named = links.map((l) => [
    view.index.titles[l.a].title,
    view.index.titles[l.b].title,
    view.index.entities[l.entity].name,
  ])
  // A bit part draws no line; A and B are joined by their director, not the theme.
  assert.deepEqual(named, [
    ['A', 'B', 'Brad Anderson'],
    ['A', 'C', 'train'],
    ['B', 'C', 'train'],
  ])
})

test('neighbours are ranked within their own media type, and a lone franchise link stays off the different side', () => {
  const start = title('Alien', [director('Ridley Scott'), { role: 'franchise', name: 'Alien Collection', key: '8091' }])
  const film = title('Near Film', [])
  const show = title('Near Show', [], 'series')
  const sequel = title('Aliens', [{ role: 'franchise', name: 'Alien Collection', key: '8091' }])
  const other = title('Prometheus', [director('Ridley Scott')])
  const { view, at } = build([start, film, show, sequel, other, title('Pad', [director('Ridley Scott')])])
  const candidates = scoreCandidates({
    view,
    start: at(start),
    neighbours: [at(show), at(film)],
    record: new Map(),
    exclude: () => false,
  })
  const byTitle = new Map(candidates.map((c) => [view.index.titles[c.title].title, c]))
  // The show came first in the merged list; each is still the closest of its kind.
  assert.deepEqual(byTitle.get('Near Show')?.reasons[0], { kind: 'feel', rank: 1 })
  assert.deepEqual(byTitle.get('Near Film')?.reasons[0], { kind: 'feel', rank: 1 })
  assert.equal(byTitle.has('Aliens'), false)
  assert.equal(byTitle.get('Prometheus')?.quadrant, 'linkedDifferent')
})

test('only listable titles use up the allowance for a credit, so watched work never crowds out the unseen', () => {
  const start = title('Start', [director('Prolific')])
  const seen = Array.from({ length: LINKED_PER_ENTITY + 5 }, (_, i) => title(`Seen ${i}`, [director('Prolific')]))
  const unseen = title('Unseen', [director('Prolific')])
  const { view, at } = build([start, ...seen, unseen])
  const watched = new Set(seen.map(at))
  const candidates = scoreCandidates({
    view,
    start: at(start),
    neighbours: [],
    record: new Map(),
    exclude: (t) => watched.has(t),
  })
  assert.deepEqual(
    candidates.map((c) => view.index.titles[c.title].title),
    ['Unseen']
  )
})
