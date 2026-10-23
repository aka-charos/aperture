import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  franchiseIdFromKey,
  itemLink,
  nextQuery,
  orderReasons,
  nextPath,
  nextPathFromTrails,
  readNextUrl,
  reasonText,
  rowLink,
  rowMembers,
  rowNote,
  rowShown,
  writeNextUrl,
  type NextUrlState,
} from './reasons'
import {
  ROW_KINDS,
  extendTrail,
  hereCaption,
  pairKey,
  stepCaption,
  stepTrail,
  titleRefFor,
  trailLookupNeeded,
} from './trail'
import { buildMapData, connectionTypeFor, type MapLabels } from './map'
import { legendConnectionTypes } from '../../components/SimilarityGraph/connectionHighlight'
import type { NextFromHereResponse, NextPeopleRow, NextReason } from './types'
import type { TrailEntity, TrailTitle } from './types'

const person = (name: string): TrailEntity => ({ key: `person:${name}`, kind: 'person', name, photo: null, titleCount: 4 })
const keyword = (name: string): TrailEntity => ({ key: `keyword:${name}`, kind: 'keyword', name, photo: null, titleCount: 3 })

let counter = 0
function card(name: string, type: 'movie' | 'series' = 'movie'): TrailTitle {
  counter += 1
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
  return { ref: `${type}:${id}`, type, id, title: name, year: 2001, posterUrl: null }
}

function row(entity: TrailEntity, members: Array<{ title: TrailTitle; seen: boolean }>, patch: Partial<NextPeopleRow> = {}): NextPeopleRow {
  return {
    entity,
    rolesThere: ['director'],
    favourite: null,
    company: null,
    members: members.map((member) => ({ ...member, roles: ['director'] })),
    more: 0,
    moreUnseen: 0,
    seenCount: members.filter((member) => member.seen).length,
    total: members.length,
    ...patch,
  }
}

test('the most telling reason leads, themes before a company, and closeness in feel comes last', () => {
  const reasons: NextReason[] = [
    { kind: 'feel', rank: 3 },
    { kind: 'company', entity: { ...person('A24'), kind: 'company' }, finished: 4, ratio: 3.2 },
    { kind: 'themes', entities: [keyword('asylum')] },
    { kind: 'shared', entity: person('Hal Hartley'), rolesThere: ['director'], rolesHere: ['director'] },
  ]
  assert.deepEqual(
    orderReasons(reasons).map((r) => r.kind),
    ['shared', 'themes', 'company', 'feel']
  )
})

test('a shared person names one role when both titles give the same one, else both', () => {
  assert.deepEqual(
    reasonText({ kind: 'shared', entity: person('Hal Hartley'), rolesThere: ['director'], rolesHere: ['director', 'writer'] }, 'Trust', 'movie'),
    { key: 'next.reason.sharedSame', name: 'Hal Hartley', role: 'director' }
  )
  assert.deepEqual(
    reasonText({ kind: 'shared', entity: person('Clint Eastwood'), rolesThere: ['lead'], rolesHere: ['director'] }, 'Dirty Harry', 'movie'),
    { key: 'next.reason.sharedDiffers', name: 'Clint Eastwood', there: 'lead', here: 'director', start: 'Dirty Harry' }
  )
  assert.deepEqual(
    reasonText(
      { kind: 'shared', entity: { ...person('Alien'), kind: 'franchise' }, rolesThere: ['franchise'], rolesHere: ['franchise'] },
      'Alien',
      'movie'
    ),
    { key: 'next.reason.franchise', name: 'Alien' }
  )
  assert.deepEqual(reasonText({ kind: 'themes', entities: [keyword('asylum'), keyword('tape recorder')] }, 'X', 'movie'), {
    key: 'next.reason.themes',
    names: ['asylum', 'tape recorder'],
  })
})

test('a favourite states the average only when the viewer rated some; the first place is said plainly', () => {
  assert.deepEqual(
    reasonText({ kind: 'favourite', entity: person('Kelly Reichardt'), rolesHere: ['director'], liked: 3, averageRating: 8.5 }, 'X', 'movie'),
    { key: 'next.reason.favouriteRated', name: 'Kelly Reichardt', role: 'director', count: 3, average: 8.5 }
  )
  assert.equal(
    reasonText({ kind: 'favourite', entity: person('K'), rolesHere: ['lead'], liked: 2, averageRating: null }, 'X', 'movie').key,
    'next.reason.favourite'
  )
  // A rank is among the suggestion's own type, so the wording names it.
  assert.equal(reasonText({ kind: 'feel', rank: 1 }, 'X', 'movie').key, 'next.reason.feelClosestMovie')
  assert.equal(reasonText({ kind: 'feel', rank: 4 }, 'X', 'series').key, 'next.reason.feelSeries')
  assert.equal(
    reasonText({ kind: 'company', entity: person('HBO'), finished: 5, ratio: 2.5 }, 'X', 'series').key,
    'next.reason.companySeries'
  )
})

test("a row's note is the viewer's record when it says something, else how much of their work they have seen", () => {
  const seen = card('Seen')
  const unseen = card('Unseen')
  const plain = row(person('Brad Anderson'), [
    { title: unseen, seen: false },
    { title: seen, seen: true },
  ])
  assert.deepEqual(rowNote(plain, 'movie'), { key: 'next.row.seenSome', seen: 1, total: 2 })
  assert.deepEqual(rowNote({ ...plain, seenCount: 0 }, 'movie'), { key: 'next.row.seenNone', total: 2 })
  assert.deepEqual(rowNote({ ...plain, favourite: { liked: 3, averageRating: 9 } }, 'movie'), {
    key: 'next.row.favouriteRated',
    count: 3,
    average: 9,
  })
  assert.deepEqual(rowNote({ ...plain, company: { finished: 4, ratio: 3.1 } }, 'series'), {
    key: 'next.row.companySeries',
    ratio: 3.1,
    count: 4,
  })
  // Hiding what was seen keeps the unseen in order and drops the rest.
  assert.deepEqual(
    rowMembers(plain, true).map((m) => m.title.title),
    ['Unseen']
  )
  assert.equal(rowMembers(plain, false).length, 2)
})

test('a step remembers the person it went through, and nothing when it was closeness alone', () => {
  const next = card('Stonehearst Asylum')
  assert.equal(itemLink({ title: next, reasons: [{ kind: 'feel', rank: 2 }] }), null)
  const link = itemLink({
    title: next,
    reasons: [
      { kind: 'feel', rank: 2 },
      { kind: 'shared', entity: person('Brad Anderson'), rolesThere: ['director'], rolesHere: ['director'] },
    ],
  })
  assert.equal(link?.name, 'Brad Anderson')
  assert.deepEqual(link?.rolesFrom, ['director'])
  const anderson = row(person('Brad Anderson'), [{ title: next, seen: false }])
  assert.deepEqual(rowLink(anderson, anderson.members[0]).rolesTo, ['director'])
})

test('the address holds the trail and the row kinds; ?title= reads as a trail of one, and defaults are left out', () => {
  const a = 'movie:00000000-0000-4000-8000-00000000000A'
  const b = 'series:00000000-0000-4000-8000-00000000000b'
  const none = { view: 'list', hideSeen: false, kinds: [] }
  assert.deepEqual(readNextUrl(new URLSearchParams({ title: a })), { trail: [a.toLowerCase()], ...none })
  assert.deepEqual(readNextUrl(new URLSearchParams(`trail=${a},movie:42,${b},${a}&view=map&hide=seen&kinds=keyword,nonsense,person`)), {
    trail: [a.toLowerCase(), b],
    view: 'map',
    hideSeen: true,
    kinds: ['person', 'keyword'],
  })
  assert.deepEqual(readNextUrl(new URLSearchParams(`trail=${a},${b}`), 1).trail, [b])
  assert.deepEqual(readNextUrl(new URLSearchParams('')), { trail: [], ...none })
  assert.equal(
    writeNextUrl({ trail: [b], view: 'list', hideSeen: false, kinds: [] }).toString(),
    new URLSearchParams({ title: b }).toString()
  )
  assert.equal(writeNextUrl({ trail: [], view: 'list', hideSeen: false, kinds: [] }).toString(), '')
  // Every kind chosen is no filter, so it is written as none.
  assert.equal(writeNextUrl({ trail: [], view: 'list', hideSeen: false, kinds: [...ROW_KINDS] }).toString(), '')
  const state: NextUrlState = { trail: [a.toLowerCase(), b], view: 'map', hideSeen: true, kinds: ['franchise', 'company'] }
  assert.deepEqual(readNextUrl(writeNextUrl(state)), state)
})

test('a row shows when its kind is chosen, or when none is', () => {
  const r = row(keyword('asylum'), [])
  assert.equal(rowShown(r, []), true)
  assert.equal(rowShown(r, ['keyword', 'company']), true)
  assert.equal(rowShown(r, ['person']), false)
})

test('an old Trails address opens the same trail here, its filters dropped', () => {
  const a = 'movie:00000000-0000-4000-8000-00000000000a'
  const b = 'series:00000000-0000-4000-8000-00000000000b'
  assert.equal(nextPathFromTrails(new URLSearchParams(`trail=${a}&unwatched=1&kinds=person`)), nextPath(a))
  assert.equal(nextPathFromTrails(new URLSearchParams(`trail=${a},movie:42,${b}`)), `/next?${new URLSearchParams({ trail: `${a},${b}` })}`)
  assert.equal(nextPathFromTrails(new URLSearchParams('mode=connect&from=x')), '/next')
  assert.equal(nextPath(a), `/next?${new URLSearchParams({ title: a })}`)
})

test('a step names the role when both titles give the same one, else both in order', () => {
  assert.deepEqual(stepCaption({ kind: 'person', rolesFrom: ['cinematographer'], rolesTo: ['cinematographer'] }), {
    key: 'next.caption.same',
    role: 'cinematographer',
  })
  assert.deepEqual(stepCaption({ kind: 'person', rolesFrom: ['lead', 'writer'], rolesTo: ['director'] }), {
    key: 'next.caption.differs',
    from: 'lead',
    to: 'director',
  })
  assert.deepEqual(stepCaption({ kind: 'franchise', rolesFrom: ['franchise'], rolesTo: ['franchise'] }), {
    key: 'next.caption.franchise',
  })
  assert.deepEqual(hereCaption('person', ['director', 'writer']), { key: 'next.here.role', role: 'director' })
  assert.deepEqual(hereCaption('keyword', ['keyword']), { key: 'next.here.keyword' })
})

test('stepping back onto the trail cuts it there, a walk is appended in order, and a long trail drops its oldest', () => {
  const A = 'movie:00000000-0000-4000-8000-000000000001'
  const B = 'series:00000000-0000-4000-8000-000000000002'
  const C = 'movie:00000000-0000-4000-8000-000000000003'
  assert.deepEqual(stepTrail([A, B], C), [A, B, C])
  assert.deepEqual(stepTrail([A, B, C], B), [A, B])
  assert.deepEqual(stepTrail([A, B], C, 2), [B, C])
  assert.deepEqual(extendTrail([A], [B, C]), [A, B, C])
  assert.deepEqual(extendTrail([A], [B, C], 2), [B, C])
  assert.equal(titleRefFor('movie', '00000000-0000-4000-8000-00000000000A'), 'movie:00000000-0000-4000-8000-00000000000a')
  assert.equal(titleRefFor('series', 'not-a-uuid'), null)
})

test('a trail is looked up only while a title or a side-by-side pair is unknown, never for a title that is gone', () => {
  const A = 'movie:00000000-0000-4000-8000-000000000001'
  const B = 'series:00000000-0000-4000-8000-000000000002'
  const C = 'movie:00000000-0000-4000-8000-000000000003'
  const cards = new Set([A, C])
  const links = new Set([pairKey(A, C)])
  const hasCard = (ref: string) => cards.has(ref)
  const hasLink = (key: string) => links.has(key)
  assert.equal(trailLookupNeeded([A, B, C], hasCard, hasLink, new Set([B])), false)
  assert.equal(trailLookupNeeded([A, B, C], hasCard, hasLink, new Set()), true)
  assert.equal(trailLookupNeeded([C, A], hasCard, hasLink, new Set()), true)
  assert.equal(trailLookupNeeded([A], hasCard, hasLink, new Set()), false)
})

test('the API is asked from the last title, the earlier ones never suggested again', () => {
  assert.equal(nextQuery([]), '')
  assert.equal(nextQuery(['movie:x']), '?title=movie%3Ax')
  assert.equal(nextQuery(['movie:a', 'movie:b', 'movie:c']), '?title=movie%3Ac&avoid=movie%3Aa%2Cmovie%3Ab')
})

test("a franchise row's page comes from its stable key", () => {
  assert.equal(franchiseIdFromKey('franchise:#8091'), '8091')
  assert.equal(franchiseIdFromKey('franchise:alien collection'), null)
  assert.equal(franchiseIdFromKey('person:#8091'), null)
})

test('a credit is drawn in its own colour: crew apart from directors and actors', () => {
  assert.equal(connectionTypeFor(person('X'), ['director']), 'director')
  assert.equal(connectionTypeFor(person('X'), ['creator']), 'director')
  assert.equal(connectionTypeFor(person('X'), ['cinematographer']), 'crew')
  assert.equal(connectionTypeFor(person('X'), ['lead']), 'actor')
  assert.equal(connectionTypeFor({ kind: 'franchise' }, ['franchise']), 'collection')
  assert.equal(connectionTypeFor({ kind: 'company' }, ['network']), 'network')
  assert.equal(connectionTypeFor({ kind: 'company' }, ['studio']), 'studio')
  assert.equal(connectionTypeFor({ kind: 'keyword' }, ['keyword']), 'keyword')
})

test('the map: the start in the middle, every line a named reason, a person before a rank as the caption', () => {
  const start = card('Session 9')
  const close = card('Stonehearst Asylum')
  const feelOnly = card('Quarantine')
  const fromRow = card('Transsiberian')
  const notDrawn = card('The Machinist')
  const anderson = person('Brad Anderson')
  const data: NextFromHereResponse = {
    start,
    close: [
      {
        title: close,
        reasons: [
          { kind: 'feel', rank: 2 },
          { kind: 'shared', entity: anderson, rolesThere: ['director'], rolesHere: ['director'] },
          { kind: 'themes', entities: [keyword('asylum')] },
        ],
      },
      { title: feelOnly, reasons: [{ kind: 'feel', rank: 4 }] },
    ],
    moreRows: [],
    people: [
      row(anderson, [
        { title: close, seen: false },
        { title: fromRow, seen: false },
        { title: notDrawn, seen: true },
      ]),
    ],
    map: {
      refs: [close.ref, feelOnly.ref, fromRow.ref],
      links: [{ from: close.ref, to: fromRow.ref, entity: anderson, rolesFrom: ['director'], rolesTo: ['director'] }],
    },
    starts: [],
  }
  const labels: MapLabels = {
    closeness: (rank, type) => `#${rank} ${type}`,
    via: (entity, roles) => `${entity.name} (${roles[0]})`,
    themes: (names) => `themes: ${names.join(', ')}`,
  }
  const graph = buildMapData(data, labels)
  assert.ok(graph)
  assert.deepEqual(
    graph.nodes.map((n) => [n.title, n.isCenter]),
    [
      ['Session 9', true],
      ['Stonehearst Asylum', false],
      ['Quarantine', false],
      ['Transsiberian', false],
    ]
  )
  const fromStart = graph.edges.filter((e) => e.source === start.id)
  assert.equal(fromStart.length, 3)
  const toClose = fromStart.find((e) => e.target === close.id)!
  assert.equal(toClose.caption, 'Brad Anderson (director)')
  assert.deepEqual(
    toClose.reasons.map((r) => r.type),
    ['similarity', 'director', 'keyword']
  )
  assert.equal(fromStart.find((e) => e.target === feelOnly.id)!.caption, '#4 movie')
  assert.equal(fromStart.find((e) => e.target === fromRow.id)!.caption, 'Brad Anderson (director)')
  // The line between two others, and nothing drawn to a title not on the map.
  const between = graph.edges.filter((e) => e.source !== start.id)
  assert.equal(between.length, 1)
  assert.equal(between[0].target, fromRow.id)
  assert.ok(graph.edges.every((e) => e.target !== notDrawn.id))
  // The legend lists what the map draws, and nothing it does not.
  assert.deepEqual(legendConnectionTypes(graph.edges, new Set(), null), [
    'director',
    'keyword',
    'similarity',
  ])
  assert.equal(buildMapData({ ...data, start: null }, labels), null)
})
