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

const lists = await import('./lists.js')
const SCOPE = { libraryIds: ['lib-a'], maxParentalRating: 13, hasMovies: true, hasSeries: true } as unknown as Parameters<
  typeof lists.recentMoviesQuery
>[0]['scope']

test('recently added: one query per kind, imports grouped once, import rows left out but counted', () => {
  for (const build of [lists.recentMoviesQuery, lists.recentSeriesQuery]) {
    const { sql, params } = build({ days: 30, genre: 'Horror', scope: SCOPE, limit: 500 })
    assert.equal(sql.match(/GROUP BY provider_library_id/g)?.length, 1, 'imports grouped once')
    assert.match(sql, /MIN\(created_at\) \+ interval '1 day' AS import_end/)
    assert.match(sql, /created_at > i\.import_end/)
    assert.match(sql, /COUNT\(\*\) FILTER/)
    // The summary survives an empty pick: a LEFT JOIN from its one row.
    assert.match(sql, /FROM summary s LEFT JOIN picked p ON TRUE/)
    // The limit is interpolated, so it is held to the list range.
    assert.match(sql, /LIMIT 40\b/)
    assert.equal(params[0], 30)
    // Every bound value is used, and nothing past them.
    const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
    assert.deepEqual([...used].sort((a, b) => a - b), params.map((_, i) => i + 1))
  }
  const series = lists.recentSeriesQuery({ days: 7, scope: SCOPE, limit: 5 }).sql
  // Episodes from the import are not new episodes, and specials never are.
  assert.match(series, /e\.created_at > ei\.import_end/)
  assert.match(series, /e\.season_number > 0/)
  // A show from the import listed for new episodes is not "left out".
  assert.match(series, /AND f\.series_id IS NULL\) AS from_import/)
})

test('recently added says what it left out, and that nothing came', () => {
  const until = new Date('2026-09-02T10:00:00Z')
  assert.equal(lists.recentlyAddedNote({ days: 30, count: 3, skipped: 0, importUntil: null }), null)
  assert.match(lists.recentlyAddedNote({ days: 30, count: 0, skipped: 0, importUntil: null }) ?? '', /last 30 days/)
  const note = lists.recentlyAddedNote({ days: 30, count: 2, skipped: 812, importUntil: until }) ?? ''
  assert.match(note, /812 titles .* \(until 2026-09-02\) are left out/)
})

test('two kinds merge into one list of at most limit, best first, ties in given order', () => {
  const entries = [
    { score: 5, item: 'm1' },
    { score: 3, item: 'm2' },
    { score: 5, item: 's1' },
    { score: 4, item: 's2' },
  ]
  assert.deepEqual(lists.mergeRanked(entries, 3), ['m1', 's1', 's2'])
  assert.deepEqual(lists.mergeRanked(entries, 10), ['m1', 's1', 's2', 'm2'])
  assert.equal(lists.mergeRanked(Array.from({ length: 90 }, (_, i) => ({ score: i, item: i })), 500).length, 40)
})

test('past issues: anything that reached someone, newest first, a partial send dated by its start', () => {
  const issue = (id: string, sentCount: number, sentAt: string | null, sendStartedAt: string | null) => ({
    id,
    sentCount,
    sentAt,
    sendStartedAt,
    updatedAt: '2026-01-01T00:00:00Z',
  })
  const sent = lists.sentIssues(
    [
      issue('draft', 0, null, null),
      issue('old', 10, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      issue('partial', 4, null, '2026-05-01T00:00:00Z'),
      issue('new', 10, '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z'),
    ],
    2
  )
  assert.deepEqual(sent.map((n) => n.id), ['partial', 'new'])
  assert.equal(lists.issueSentOn(sent[0]), '2026-05-01T00:00:00Z')
})
