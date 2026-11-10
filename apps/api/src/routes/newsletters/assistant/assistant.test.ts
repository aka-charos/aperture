/**
 * The newsletter writing assistant: its tool list, its schemas, the outline it
 * reads of the draft, and the rules its prompt must carry.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { asSchema } from 'ai'
import { readNewsletterDocument } from '@aperture/core'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool } = await import('../../../lib/db.js')
const { createTools } = await import('../../assistant/tools/index.js')
const { REUSED_TOOLS, buildNewsletterToolCatalog } = await import('./catalog.js')
const { OUTLINE_MAX_CHARS, outlineDraft } = await import('./draftSummary.js')
const { newsletterSystemPrompt } = await import('./prompt.js')

after(async () => {
  await closePool()
})

type Context = Parameters<typeof buildNewsletterToolCatalog>[0]
const ctx = {
  userId: '00000000-0000-0000-0000-000000000000',
  isAdmin: true,
  scope: { libraryIds: null, maxParentalRating: null, hasMovies: true, hasSeries: true },
  embedding: {},
  mediaServer: null,
} as unknown as Context
const draft = { subject: '', preheader: '', content: { type: 'doc', content: [] }, groupIds: [] }

test('every reused tool still exists in the chat catalog', () => {
  const chat = createTools(ctx)
  for (const name of REUSED_TOOLS) assert.ok(name in chat, `${name} is gone from the chat tools`)
})

test('the viewer-personal and web tools are not offered', () => {
  const names = Object.keys(buildNewsletterToolCatalog(ctx, draft))
  for (const name of [
    'getMyRecommendations',
    'searchMyRecommendations',
    'getWatchHistory',
    'getUserRatings',
    'getUnwatched',
    'getUpcomingEpisodes',
    'findCandidatesInLibrary',
    'search_web',
  ]) {
    assert.ok(!names.includes(name), `${name} should not be offered`)
  }
  for (const name of ['proposeDraft', 'readCurrentDraft', 'checkAudienceReach', 'getPastIssues', 'getRecentlyAdded']) {
    assert.ok(names.includes(name), `${name} missing`)
  }
})

test('every tool has a provider-safe name and an object root with no top-level union', async () => {
  const problems: string[] = []
  for (const [name, definition] of Object.entries(buildNewsletterToolCatalog(ctx, draft))) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) problems.push(`${name}: unsafe name`)
    const schema = (await asSchema(definition.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema) as Record<
      string,
      unknown
    >
    if (schema.type !== 'object') problems.push(`${name}: root is ${String(schema.type)}`)
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (schema[key]) problems.push(`${name}: root has ${key}`)
  }
  assert.deepEqual(problems, [])
})

test('proposeDraft shows the model a summary, never the editor nodes', async () => {
  const proposeDraft = buildNewsletterToolCatalog(ctx, draft).proposeDraft as {
    toModelOutput?: (output: unknown) => { type: string; value: string }
  }
  const output = proposeDraft.toModelOutput?.({
    proposal: {
      subject: 'Hi',
      preheader: null,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      titles: [],
      dropped: [],
      problem: null,
    },
  })
  assert.equal(output?.type, 'text')
  assert.match(output?.value ?? '', /NOT in the newsletter/)
  assert.doesNotMatch(output?.value ?? '', /"type":"paragraph"/)
})

const ID = '11111111-1111-4111-8111-111111111111'

test('the draft outline reads the document as the email would, title cards by name', () => {
  const parts = readNewsletterDocument({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '<b>raw</b>' }] },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
      },
      { type: 'titleCard', attrs: { mediaType: 'movie', id: ID, fields: ['poster', 'plot'] } },
    ],
  })
  const outline = outlineDraft({ subject: ' Subj ', preheader: '' }, parts, () => 'Heat (1995)')
  assert.deepEqual(outline.outline, ['## Hello', '<b>raw</b>', '- item', '[Title card: Heat (1995) — shows poster, plot]'])
  assert.equal(outline.subject, 'Subj')
  assert.equal(outline.titleCount, 1)
  assert.equal(outline.truncated, false)
})

test('a long draft is cut to the outline budget and says so, still counting its cards', () => {
  const long = 'word '.repeat(150)
  const content = [
    ...Array.from({ length: 40 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: long }] })),
    { type: 'titleCard', attrs: { mediaType: 'movie', id: ID } },
  ]
  const outline = outlineDraft({ subject: '', preheader: '' }, readNewsletterDocument({ type: 'doc', content }), () => 'T')
  assert.equal(outline.truncated, true)
  assert.ok(outline.outline.join('').length <= OUTLINE_MAX_CHARS)
  assert.equal(outline.titleCount, 1)
})

test('the prompt carries the rules that must hold', () => {
  const prompt = newsletterSystemPrompt({
    appName: 'Aperture',
    serverName: 'Home',
    languageInstruction: 'Respond in English.',
    audience: { recipients: 3, byLanguage: { en: 2, el: 1 } },
    titleFields: ['poster', 'plot', 'analysis'],
    defaultTitleFields: ['poster', 'plot'],
    analysisParts: { movie: ['work'], series: ['work', 'structure'] },
    today: '2026-11-10',
  })
  for (const rule of [/Facts only from tools/, /No spoilers/, /Nobody is named/, /proposeDraft/, /Ids from results only/]) {
    assert.match(prompt, rule)
  }
  assert.match(prompt, /reach 3 people \(app languages: en 2, el 1\)/)
  assert.match(prompt, /\*\*Home\*\*/)
  const noGroups = newsletterSystemPrompt({
    appName: 'Aperture',
    serverName: null,
    languageInstruction: '',
    audience: null,
    titleFields: [],
    defaultTitleFields: [],
    analysisParts: { movie: [], series: [] },
    today: '2026-11-10',
  })
  assert.match(noGroups, /No send groups are chosen yet/)
})

test('the history cut always opens with a question', async () => {
  const { recentHistory } = await import('./history.js')
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', i }))
  // 25 messages (u,a,…,u): a plain cut to 24 would open on an answer.
  const cut = recentHistory(turns(25), 24)
  assert.equal(cut[0].role, 'user')
  assert.equal(cut.length, 23)
  assert.equal(cut.at(-1)?.i, 24)
  assert.equal(recentHistory(turns(5), 24).length, 5)
  assert.deepEqual(recentHistory([{ role: 'assistant' }], 24), [])
})
