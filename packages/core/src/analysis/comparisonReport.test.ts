import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  criticismLine,
  renderComparisonReport,
  type ComparisonEntry,
  type ComparisonReport,
} from './comparisonReport.js'

const entry = (over: Partial<ComparisonEntry> = {}): ComparisonEntry => ({
  provider: 'lmstudio',
  model: 'ornith-1.5-9b',
  promptVersion: 7,
  status: 'ok',
  analysis: 'The film is built around a black-and-white image.',
  grade: 'substantial',
  problem: null,
  finishReason: 'stop',
  inputTokens: 18000,
  outputTokens: 600,
  reasoningTokens: 0,
  durationMs: 42_000,
  error: null,
  sections: [['work']],
  ...over,
})

const report = (over: Partial<ComparisonReport> = {}): ComparisonReport => ({
  title: 'The Girl With The Needle',
  year: 2024,
  mediaType: 'movie',
  promptVersion: 7,
  sources: [{ title: 'Review', domain: 'sensesofcinema.com', chars: 8000 }],
  retrievedChars: 8000,
  prompt: 'THE PROMPT BODY',
  entries: [entry()],
  startedAt: '2026-09-09T10:00:00Z',
  finishedAt: '2026-09-09T10:05:00Z',
  ...over,
})

/**
 * A variant answers under its base version's number, so without its own name in
 * the label two answers to two different prompts read as one prompt run twice.
 */
test('an answer written under a variant is named with it', () => {
  const text = renderComparisonReport(
    report({
      promptVersion: 15,
      entries: [
        entry({ promptVersion: 15, model: 'ornith-1.5-9b' }),
        entry({ promptVersion: 15, promptVariant: 'compact', model: 'ornith-1.5-9b' }),
      ],
    })
  )
  assert.match(text, /Prompt versions: 15, 15 compact/)
  assert.match(text, /· v15 compact/)
  assert.match(text, /ornith-1.5-9b · v15\n/)
})

test('a variant prompt prints from TASK on, under the version printed in full', () => {
  const text = renderComparisonReport(
    report({
      promptVersion: 15,
      prompts: [
        { version: 15, variant: 'compact', text: 'HEADER\nTASK\ncompact task' },
        { version: 15, variant: null, text: 'HEADER\nTASK\nbase task' },
      ],
      entries: [
        entry({ promptVersion: 15 }),
        entry({ promptVersion: 15, promptVariant: 'compact' }),
      ],
    })
  )
  assert.match(text, /--- PROMPT VERSION 15, in full ---/)
  assert.match(
    text,
    /--- PROMPT VERSION 15 compact, from TASK on \(everything above it is identical to version 15\) ---/
  )
  assert.ok(text.indexOf('base task') < text.indexOf('compact task'))
})

test('states the shared control before any answer', () => {
  const text = renderComparisonReport(report())
  const sourcesAt = text.indexOf('sensesofcinema.com')
  const answerAt = text.indexOf('The film is built around')
  assert.ok(sourcesAt > -1 && answerAt > -1)
  assert.ok(sourcesAt < answerAt, 'sources must be stated above the answers')
  assert.match(text, /Prompt version: 7/)
  assert.match(text, /answered the SAME prompt/)
})

/**
 * The whole point of a bench is that a model which cannot produce an answer has
 * told you something. A report listing only the successes would present a
 * three-model comparison as a one-model one.
 */
test('prints failed and unusable entries rather than dropping them', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry(),
        entry({
          model: 'broken-model',
          status: 'error',
          analysis: null,
          error: 'Connection refused',
        }),
        entry({
          model: 'runaway-model',
          status: 'unusable',
          analysis: null,
          problem: 'truncated',
          error: null,
        }),
      ],
    })
  )

  assert.match(text, /broken-model/)
  assert.match(text, /\[failed\] Connection refused/)
  assert.match(text, /runaway-model/)
  assert.match(text, /\[unusable\].*truncated/)
})

test('a model not yet reached says so instead of looking empty', () => {
  const text = renderComparisonReport({
    ...report(),
    entries: [entry({ status: 'pending', analysis: null, error: null, durationMs: null })],
  })
  assert.match(text, /\[not run\]/)
})

test('keeps the requested order and numbers the entries', () => {
  const text = renderComparisonReport(
    report({
      entries: [entry({ model: 'first' }), entry({ model: 'second' }), entry({ model: 'third' })],
    })
  )
  assert.ok(text.indexOf('[1] lmstudio / first') < text.indexOf('[2] lmstudio / second'))
  assert.ok(text.indexOf('[2] lmstudio / second') < text.indexOf('[3] lmstudio / third'))
})

/**
 * The prompt is long and identical on every run, so it must not sit between the
 * reader and the prose they opened the report to compare.
 */
test('the prompt goes last, below every answer', () => {
  const text = renderComparisonReport(report())
  assert.ok(text.indexOf('The film is built around') < text.indexOf('THE PROMPT BODY'))
  assert.ok(text.indexOf('THE PROMPT EVERY MODEL RECEIVED') < text.indexOf('THE PROMPT BODY'))
})

test('a run with no prompt yet omits the prompt section entirely', () => {
  const text = renderComparisonReport(report({ prompt: null }))
  assert.doesNotMatch(text, /THE PROMPT EVERY MODEL RECEIVED/)
})

/**
 * Zero reasoning tokens and a provider that reports none are different facts,
 * and neither is worth a column that reads "0 reasoning" on every row.
 */
test('reasoning tokens appear only when some were spent', () => {
  assert.doesNotMatch(renderComparisonReport(report()), /reasoning/)
  const spent = renderComparisonReport({
    ...report(),
    entries: [entry({ reasoningTokens: 10_010 })],
  })
  assert.match(spent, /10010 reasoning/)
})

test('reports the shape of the answer from the labels the model wrote', () => {
  const text = renderComparisonReport({
    ...report(),
    entries: [entry({ sections: [['work'], ['tradition', 'dispute'], []] })],
  })
  assert.match(text, /sections: 1\. work {3}2\. tradition\+dispute {3}3\. —/)
})

test('every answer carries its habit counts, and the table lists every entry', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry({ analysis: 'It is inherited rather than borrowed.' }),
        entry({ model: 'broken-model', status: 'error', analysis: null, error: 'Refused' }),
      ],
    })
  )
  assert.match(text, /SIGNALS/)
  assert.match(text, /"rather than" 1/)
  // A failed entry still gets its row, with a dash instead of numbers.
  assert.match(text, /\[2\] lmstudio \/ broken-model · v7\s+—/)
  assert.ok(text.indexOf('SIGNALS') < text.indexOf('It is inherited'), 'table above the prose')
})

/**
 * A replay is two runs in one document. The baseline's answers must follow this
 * run's, the pair must sit on adjacent rows of the table, and a baseline model
 * this run did not repeat must still be printed.
 */
test('a replay prints the baseline after its own answers and pairs the table rows', () => {
  const text = renderComparisonReport(
    report({
      promptVersion: 9,
      entries: [entry({ model: 'deepseek', promptVersion: 9, analysis: 'Version nine prose.' })],
      replayOf: {
        runId: 'run-8',
        promptVersion: 8,
        startedAt: '2026-09-10T10:00:00Z',
        entries: [
          entry({ model: 'dropped-model', promptVersion: 8, analysis: 'Only in the old run.' }),
          entry({
            model: 'deepseek',
            promptVersion: 8,
            analysis: 'Version eight prose, rather than nine.',
          }),
        ],
      },
    })
  )

  assert.match(text, /PROMPT REPLAY/)
  assert.match(text, /Replaying run run-8 \(prompt version 8/)
  assert.match(text, /reused unchanged/)

  const table = text.slice(text.indexOf('SIGNALS'), text.indexOf('Version nine prose.'))
  const lines = table.split('\n')
  const v9 = lines.findIndex((line) => line.startsWith('[1] lmstudio / deepseek · v9'))
  assert.ok(v9 > -1, table)
  assert.ok(lines[v9 + 1].startsWith('[b2] lmstudio / deepseek · v8'), table)
  assert.ok(lines[v9 + 2].startsWith('[b1] lmstudio / dropped-model · v8'), table)

  assert.ok(text.indexOf('Version nine prose.') < text.indexOf('BASELINE — run run-8'))
  assert.ok(text.indexOf('BASELINE — run run-8') < text.indexOf('Version eight prose'))
  assert.ok(text.indexOf('Only in the old run.') < text.indexOf('THE PROMPT BODY'))
})

/**
 * Several prompt versions in one run: the point is reading one model's answers
 * to each version side by side, so they must be adjacent, and the prompt section
 * must show what differs without printing the same 60k of documents twice.
 */
test('several prompt versions: answers named by version, documents printed once', () => {
  const shared = 'Film: X\n\nSOURCE DOCUMENTS\n[1] Doc — d.com\nBody.\n\nTASK\n'
  const text = renderComparisonReport(
    report({
      promptVersion: 9,
      entries: [
        entry({ model: 'a', promptVersion: 8, analysis: 'A under eight.' }),
        entry({ model: 'a', promptVersion: 9, analysis: 'A under nine.' }),
        entry({ model: 'b', promptVersion: 8, analysis: 'B under eight.' }),
        entry({ model: 'b', promptVersion: 9, analysis: 'B under nine.' }),
      ],
      prompt: `${shared}NINE QUESTIONS`,
      prompts: [
        { version: 8, text: `${shared}EIGHT QUESTIONS` },
        { version: 9, text: `${shared}NINE QUESTIONS` },
      ],
    })
  )

  assert.match(text, /Prompt versions: 8, 9/)
  assert.match(text, /differ only in their questions and rules/)
  assert.ok(text.indexOf('[1] lmstudio / a · v8') < text.indexOf('[2] lmstudio / a · v9'))
  assert.ok(text.indexOf('[2] lmstudio / a · v9') < text.indexOf('[3] lmstudio / b · v8'))

  assert.equal(text.split('SOURCE DOCUMENTS').length - 1, 1, 'documents once')
  assert.ok(text.includes('EIGHT QUESTIONS') && text.includes('NINE QUESTIONS'))
  assert.ok(text.indexOf('PROMPT VERSION 9, in full') < text.indexOf('PROMPT VERSION 8, from TASK on'))
  assert.doesNotMatch(text, /THE PROMPT EVERY MODEL RECEIVED/)
})

// The one signal a reader has to judge, so its phrases are printed, and it
// needs the model's labels, which the entry already carries.
test('a fact told under two questions is counted and named in the report', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry({
          analysis: [
            'Cameron kept a liquid-metal idea from an early draft.',
            'The pursuer moves without effort.',
            'The liquid-metal idea waited for better effects.',
          ].join('\n\n'),
          sections: [['tradition'], ['work'], ['circumstances']],
        }),
      ],
    })
  )
  assert.match(text, /told twice \d+ \([^)]*liquid metal/)
  assert.match(text, /\s+twice\s+spill\s+praise\s+awards\s+semi\s+rec\/work\n/)
})

/**
 * GLM's Terminator 2 answer under version 13 carried no usable map, and the
 * table printed 0 for "twice" and "spill" as if it had been measured clean.
 */
test('an answer with no map prints dashes for what the map measures', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry({ model: 'mapped', analysis: 'The work.\n\nThe reception, longer than the work.', sections: [['work'], ['reception']] }),
        entry({ model: 'unmapped', analysis: 'The work.\n\nThe reception; longer.', sections: [] }),
      ],
    })
  )
  const row = (name: string) => text.split('\n').find((line) => line.includes(' / ' + name + ' · v7 '))!
  assert.match(row('mapped'), /\s0\s+0\s+0\s+6\/2!$/)
  assert.match(row('unmapped'), /\s—\s+—\s+—\s+0\s+1\s+—$/)
  assert.match(text, /told twice — \(no map\)/)
  assert.match(text, /writers outside reception —/)
  assert.match(text, /reception 6 words, work 2 \(reception longer\)/)
})

test('an ordinary run says nothing about replaying', () => {
  const text = renderComparisonReport(report())
  assert.match(text, /MODEL COMPARISON/)
  assert.doesNotMatch(text, /BASELINE|Replaying|reused unchanged/)
})

test('an unmapped analysis prints no sections line rather than an empty one', () => {
  const text = renderComparisonReport({ ...report(), entries: [entry({ sections: [] })] })
  assert.doesNotMatch(text, /sections:/)
  assert.match(text, /map: none written/)
})

// A rejected map and a missing one have different fixes, and GLM's two
// unmapped answers could only be told apart with a database query.
test('a map that could not be read is printed on one line', () => {
  const text = renderComparisonReport({
    ...report(),
    entries: [entry({ sections: [], mapText: '1: tradition\n2: work\n9: reception\n' })],
  })
  assert.match(text, /map not read: 1: tradition \| 2: work \| 9: reception\n/)

  const long = renderComparisonReport({
    ...report(),
    entries: [entry({ sections: [], mapText: 'x'.repeat(500) })],
  })
  assert.match(long, /map not read: x{240}…\n/)

  // A readable map prints its sections and nothing about the raw text.
  const mapped = renderComparisonReport({ ...report(), entries: [entry({ mapText: '1: work' })] })
  assert.doesNotMatch(mapped, /map not read|map: none/)
})

test('a criticism document is marked, and the count says so', () => {
  const out = criticismLine([
    { title: 'A', domain: 'rogerebert.com', chars: 100, curated: true },
    { title: 'B', domain: 'en.wikipedia.org', chars: 100 },
  ])
  assert.match(out, /1 came from the curated criticism search/)
})

test('no marked source never claims the search found nothing', () => {
  // Three different things produce this zero - the search found nothing, the
  // run predates the curated search, or the build has no curated search - and
  // the list cannot tell them apart. Stating the first would send someone to
  // debug a query that is working.
  const out = criticismLine([{ title: 'A', domain: 'en.wikipedia.org', chars: 100 }])
  assert.match(out, /either it found nothing .* or this run was made without it/)
  assert.ok(!/^Of these/.test(out))
})

test('the marker rides on the source line, not on the heading alone', () => {
  const rendered = renderComparisonReport(
    report({
      sources: [
        { title: 'On Requiem', domain: 'sensesofcinema.com', chars: 4200, curated: true },
        { title: 'Requiem for a Dream', domain: 'en.wikipedia.org', chars: 9000 },
      ],
    })
  )
  assert.match(rendered, /sensesofcinema\.com — On Requiem \(4,200 chars\) \[criticism\]/)
  assert.ok(!/en\.wikipedia\.org.*\[criticism\]/.test(rendered))
})

/**
 * A REJECTED ANSWER SAYS IT WAS REJECTED, EVEN WHEN IT HAS PROSE.
 *
 * The failure line only ever printed when there was nothing else to print, so a
 * model that broke the contract and still wrote something rendered identically
 * to one that succeeded. Measured on the Suspiria bench, where one model failed
 * both its entries - one labelling six of ten paragraphs, one running to 304
 * with no closing contract line - and both read as answers.
 */
test('an answer that broke the contract is marked, prose or no prose', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry({
          status: 'unusable',
          problem: 'no_contract_line',
          grade: null,
          analysis: 'A phantasmagoria of unnatural colours, repeated without end.',
        }),
      ],
    })
  )
  assert.ok(text.includes('[UNUSABLE]'), 'the entry is marked above its prose')
  assert.ok(text.includes('no_contract_line'), 'and names which check rejected it')
  assert.ok(text.includes('[1] lmstudio / ornith-1.5-9b · v7 [unusable]'), 'and so is its row')
  assert.ok(text.includes('A phantasmagoria'), 'while the prose is still printed to be read')
})

/** The control: a good answer carries no marker anywhere. */
test('an accepted answer is not marked', () => {
  const text = renderComparisonReport(report())
  assert.equal(text.includes('[UNUSABLE]'), false)
  assert.equal(text.includes('[unusable]'), false)
})
