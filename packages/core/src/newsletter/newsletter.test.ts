import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderEmail, type EmailFrame } from '../email/template.js'
import {
  matchesRules,
  membership,
  newsletterEligibility,
  readGroupRules,
  resolveRecipients,
  type AudienceUser,
} from './audience.js'
import { buildNewsletterContent, posterRequestUrl, type TitleFacts } from './build.js'
import {
  DEFAULT_TITLE_FIELDS,
  NEWSLETTER_MAX_TITLES,
  newsletterDocumentProblem,
  readNewsletterDocument,
  titleRefsIn,
} from './document.js'

const MOVIE_ID = '11111111-1111-4111-8111-111111111111'
const SERIES_ID = '22222222-2222-4222-8222-222222222222'

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', text: value, marks })

// ----------------------------------------------------------------- document

test('the editor document is read into blocks of plain text, never markup', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('<b>Hi</b>')] },
      {
        type: 'paragraph',
        content: [
          text('bold', [{ type: 'bold' }]),
          { type: 'hardBreak' },
          text('link', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'mystery' }]),
        ],
      },
      { type: 'paragraph', content: [] },
      { type: 'horizontalRule' },
      { type: 'iframe', content: [text('kept as text')] },
    ],
  })
  assert.deepEqual(parts[0], { type: 'heading', level: 2, runs: [{ text: '<b>Hi</b>' }] })
  assert.deepEqual(parts[1], {
    type: 'paragraph',
    runs: [{ text: 'bold', bold: true }, { text: '\n' }, { text: 'link', href: 'javascript:alert(1)' }],
  })
  assert.deepEqual(parts[2], { type: 'rule' })
  assert.deepEqual(parts[3], { type: 'paragraph', runs: [{ text: 'kept as text' }] })
  assert.equal(parts.length, 4, 'an empty paragraph is dropped')

  const html = renderEmail(
    { subject: 's', heading: 'h', paragraphs: [], blocks: parts.filter((p) => p.type !== 'titleRef') as never, footer: [] },
    frame
  ).html
  assert.ok(!html.includes('<b>Hi'), 'heading text is escaped')
  assert.ok(html.includes('&lt;b&gt;Hi&lt;/b&gt;'))
  assert.ok(!html.includes('javascript:'), 'a non-http link is dropped')
  assert.ok(html.includes('<strong>bold</strong><br>'))
})

test('nested lists flatten, and list items keep their text', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [text('one')] },
              {
                type: 'orderedList',
                content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('one.a')] }] }],
              },
            ],
          },
          { type: 'listItem', content: [{ type: 'paragraph', content: [text('two')] }] },
        ],
      },
    ],
  })
  assert.deepEqual(parts, [
    { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'one.a' }], [{ text: 'two' }]] },
  ])
})

test('a title card keeps only a valid reference and known fields, in canonical order', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [
      { type: 'titleCard', attrs: { mediaType: 'movie', id: MOVIE_ID, fields: ['link', 'bogus', 'poster', 'plot'] } },
      { type: 'titleCard', attrs: { mediaType: 'series', id: SERIES_ID } },
      { type: 'titleCard', attrs: { mediaType: 'movie', id: "1' OR 1=1" } },
      { type: 'titleCard', attrs: { mediaType: 'episode', id: MOVIE_ID } },
      { type: 'titleCard', attrs: { mediaType: 'movie', id: MOVIE_ID, fields: [] } },
    ],
  })
  assert.equal(parts.length, 3)
  assert.deepEqual(parts[0], { type: 'titleRef', mediaType: 'movie', id: MOVIE_ID, fields: ['poster', 'plot', 'link'] })
  assert.deepEqual((parts[1] as { fields: string[] }).fields, [...DEFAULT_TITLE_FIELDS], 'no fields stored = the defaults')
  assert.deepEqual(titleRefsIn(parts), [
    { mediaType: 'movie', id: MOVIE_ID },
    { mediaType: 'series', id: SERIES_ID },
  ])
})

test('a document is refused when it is not one, or shows too many titles', () => {
  assert.ok(newsletterDocumentProblem('<p>hi</p>'))
  assert.equal(newsletterDocumentProblem({ type: 'doc', content: [] }), null)
  const many = Array.from({ length: NEWSLETTER_MAX_TITLES + 1 }, (_, i) => ({
    type: 'titleCard',
    attrs: { mediaType: 'movie', id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` },
  }))
  assert.ok(newsletterDocumentProblem({ type: 'doc', content: many }))
})

// ----------------------------------------------------------------- audience

const user = (over: Partial<AudienceUser> = {}): AudienceUser => ({
  id: 'u1',
  username: 'alex',
  displayName: null,
  email: 'alex@example.com',
  isAdmin: false,
  isEnabled: true,
  providerDisabled: false,
  optedIn: true,
  language: 'en',
  ...over,
})

test('group rules read defensively', () => {
  assert.deepEqual(readGroupRules(null), { match: 'rules', languages: [], role: 'any' })
  assert.deepEqual(readGroupRules({ match: 'none', languages: ['el', 'xx', 'el'], role: 'root' }), {
    match: 'none',
    languages: ['el'],
    role: 'any',
  })
})

test('rules filter by language and role; none matches nobody', () => {
  const greek = { match: 'rules' as const, languages: ['el' as const], role: 'any' as const }
  assert.equal(matchesRules(user({ language: 'el' }), greek), true)
  assert.equal(matchesRules(user({ language: 'en' }), greek), false)
  assert.equal(matchesRules(user({ isAdmin: true }), { match: 'rules', languages: [], role: 'viewers' }), false)
  assert.equal(matchesRules(user(), { match: 'none', languages: [], role: 'any' }), false)
})

test('an exclusion beats an inclusion beats the rules', () => {
  const rules = { match: 'rules' as const, languages: ['el' as const], role: 'any' as const }
  assert.deepEqual(membership(user({ language: 'el' }), rules, 'exclude'), { member: false, reason: 'excluded' })
  assert.deepEqual(membership(user({ language: 'en' }), rules, 'include'), { member: true, reason: 'included' })
  assert.deepEqual(membership(user({ language: 'el' }), rules, undefined), { member: true, reason: 'rules' })
})

test('only someone who opted in, with an address and access, is sent anything', () => {
  assert.equal(newsletterEligibility(user()), null)
  assert.equal(newsletterEligibility(user({ optedIn: false })), 'notOptedIn')
  assert.equal(newsletterEligibility(user({ email: 'not an address' })), 'noAddress')
  assert.equal(newsletterEligibility(user({ email: null })), 'noAddress')
  assert.equal(newsletterEligibility(user({ isEnabled: false })), 'noAccess')
  assert.equal(newsletterEligibility(user({ providerDisabled: true })), 'noAccess')
})

test('recipients are members of any group, eligible, and listed once', () => {
  const users = [
    user({ id: 'a', username: 'b-greek', language: 'el' }),
    user({ id: 'b', username: 'a-english' }),
    user({ id: 'c', username: 'c-not-opted', language: 'el', optedIn: false }),
  ]
  const groups = [
    { id: 'g1', rules: readGroupRules({ languages: ['el'] }), members: new Map() },
    { id: 'g2', rules: readGroupRules({ match: 'none' }), members: new Map([['a', 'include' as const], ['c', 'include' as const]]) },
  ]
  assert.deepEqual(
    resolveRecipients(users, groups).map((u) => u.id),
    ['a'],
    'hand-adding someone does not subscribe them'
  )
})

// -------------------------------------------------------------------- build

const frame: EmailFrame = { lang: 'el', rtl: false, appName: 'Cinema', accent: '#6366f1', homeUrl: 'https://c.example' }

const facts: TitleFacts = {
  ref: { mediaType: 'movie', id: MOVIE_ID },
  title: 'Aniara',
  year: 2018,
  endYear: null,
  runtimeMinutes: 106,
  genres: ['Science Fiction'],
  rating: { source: 'imdb', value: 6.3 },
  directors: ['Pella Kågerman'],
  cast: ['Emelie Jonsson'],
  network: null,
  languages: ['Swedish'],
  countries: ['Sweden'],
  overview: 'A ship drifts.',
  plotFull: null,
  posterUrl: null,
}

test('a title card is built in the reader language and only from the chosen fields', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [{ type: 'titleCard', attrs: { mediaType: 'movie', id: MOVIE_ID, fields: ['year', 'genres', 'languages', 'plot', 'link'] } }],
  })
  const { content } = buildNewsletterContent({
    envelope: { subject: 'Νέα', preheader: '' },
    parts,
    facts: new Map([[`movie:${MOVIE_ID}`, facts]]),
    edition: {
      language: 'el',
      genreNames: { 'Science Fiction': 'Επιστημονική Φαντασία' },
      text: new Map([[`movie:${MOVIE_ID}`, { overview: 'Ένα σκάφος.', plotFull: null, analysis: [] }]]),
    },
    images: new Map(),
    context: { locale: 'el', frame, linkBase: 'https://c.example' },
    copy: { visibleTitles: null, unsubscribeUrl: 'https://c.example/api/newsletter/unsubscribe?token=t' },
  })
  const card = content.blocks?.[0]
  assert.equal(card?.type, 'title')
  if (card?.type !== 'title') return
  assert.equal(card.meta, '2018')
  assert.deepEqual(card.facts, [
    { label: 'Είδη', value: 'Επιστημονική Φαντασία' },
    { label: 'Γλώσσες', value: 'Swedish' },
  ])
  assert.deepEqual(card.passages, [{ label: 'Υπόθεση', paragraphs: ['Ένα σκάφος.'] }])
  assert.equal(card.url, `https://c.example/movies/${MOVIE_ID}`)
  assert.equal(content.footerLink?.url, 'https://c.example/api/newsletter/unsubscribe?token=t')

  const rendered = renderEmail(content, frame)
  assert.ok(rendered.html.includes('Διαγραφή από τη λίστα'))
  assert.ok(rendered.text.includes('== Aniara (2018) =='))
})

test('a title outside the reader scope is left out of their copy', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [text('Hello')] },
      { type: 'titleCard', attrs: { mediaType: 'movie', id: MOVIE_ID } },
    ],
  })
  const { content } = buildNewsletterContent({
    envelope: { subject: 's', preheader: '' },
    parts,
    facts: new Map([[`movie:${MOVIE_ID}`, facts]]),
    edition: { language: 'en', genreNames: {}, text: new Map() },
    images: new Map(),
    context: { locale: 'en', frame: { ...frame, lang: 'en' }, linkBase: null },
    copy: { visibleTitles: new Set(), unsubscribeUrl: null },
  })
  assert.deepEqual(content.blocks?.map((b) => b.type), ['paragraph'])
  assert.equal(content.footerLink, undefined)
})

test('the poster is asked for at a width, and only over http(s)', () => {
  assert.equal(
    posterRequestUrl('http://emby:8096/Items/1/Images/Primary?tag=abc'),
    'http://emby:8096/Items/1/Images/Primary?tag=abc&maxWidth=240'
  )
  assert.equal(posterRequestUrl('http://emby/x?maxWidth=100'), 'http://emby/x?maxWidth=100')
  assert.equal(posterRequestUrl('file:///etc/passwd'), null)
  assert.equal(posterRequestUrl(null), null)
})
