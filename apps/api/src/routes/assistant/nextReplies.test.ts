/**
 * Suggested replies: what the model writes is cleaned into at most three
 * short, distinct drafts; the prompt carries only what the reader was shown.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const {
  parseNextReplies,
  cardTitles,
  buildNextRepliesPrompt,
  MAX_NEXT_REPLIES,
  NEXT_REPLY_MAX_CHARS,
} = await import('./nextReplies.js')

test('numbering, bullets, quotes and an introduction are stripped', () => {
  const text = [
    'Here are some ideas:',
    '1. "More like Heat, but newer"',
    '- Why did you pick Collateral?',
    '• «Only films under two hours»',
  ].join('\n')
  assert.deepEqual(parseNextReplies(text), [
    'More like Heat, but newer',
    'Why did you pick Collateral?',
    'Only films under two hours',
  ])
})

test('at most three, no repeats, never the question again, nothing overlong', () => {
  const text = [
    'Something else entirely',
    'films like heat', // the question, differently cased
    'Show me thrillers',
    'show me thrillers',
    'x'.repeat(NEXT_REPLY_MAX_CHARS + 1),
    'Any series instead?',
    'One more',
    'And another',
  ].join('\n')
  const replies = parseNextReplies(text, 'Films like Heat')
  assert.equal(replies.length, MAX_NEXT_REPLIES)
  assert.deepEqual(replies, ['Something else entirely', 'Show me thrillers', 'Any series instead?'])
})

test('nothing usable comes back empty, so the caller refuses it', () => {
  assert.deepEqual(parseNextReplies('\n  \nSuggestions:\n'), [])
})

test('card titles are read from lists and carousels, once each, in order', () => {
  const invocations = [
    { toolName: 'semanticSearch', result: { items: [{ title: 'Heat' }, { title: 'Collateral' }] } },
    {
      toolName: 'findCandidatesInLibrary',
      result: { carousels: [{ items: [{ title: 'Thief' }, { title: 'Heat' }] }, { items: [] }] },
    },
    { toolName: 'getContentDetails', result: { item: { title: 'Manhunter' } } },
    { toolName: 'semanticSearch', result: { id: 'x', brief: 'Heat (1995)', count: 1 } },
    null,
  ]
  assert.deepEqual(cardTitles(invocations), ['Heat', 'Collateral', 'Thief', 'Manhunter'])
  assert.deepEqual(cardTitles(null), [])
})

test('the prompt holds the question, the answer, the titles and the language', () => {
  const prompt = buildNextRepliesPrompt({
    question: 'Films like Heat',
    answer: 'Try Thief and Collateral.',
    titles: ['Thief', 'Collateral'],
    languageInstruction: 'Write all output in Greek (el).',
  })
  assert.match(prompt, /Films like Heat/)
  assert.match(prompt, /Try Thief and Collateral\./)
  assert.match(prompt, /Thief; Collateral/)
  assert.match(prompt, /Greek \(el\)/)
  // An answer that was only cards leaves out the empty answer block.
  assert.doesNotMatch(
    buildNextRepliesPrompt({ question: 'q', answer: '  ', titles: ['A'], languageInstruction: 'L' }),
    /assistant's answer/
  )
})
