import test from 'node:test'
import assert from 'node:assert/strict'

import { budgetSources } from './budget.js'
import { MIN_SUBSTANTIVE_SOURCE_CHARS } from './sourceFloor.js'
import type { AnalysisSource } from './prompt.js'

const source = (name: string, chars: number): AnalysisSource => ({
  title: name,
  domain: `${name}.example.org`,
  // Spaces so the word-boundary clip has something to find, as real prose would.
  text: `${name} `.repeat(Math.ceil(chars / (name.length + 1))).slice(0, chars),
})

const totalChars = (sources: AnalysisSource[]) =>
  sources.reduce((sum, s) => sum + s.text.length, 0)

test('everything fits, nothing is touched', () => {
  const input = [source('a', 1000), source('b', 2000)]
  const out = budgetSources(input, { budget: 10000 })
  assert.deepEqual(out, input)
})

test('over budget, the result fits the budget', () => {
  const input = [source('a', 20000), source('b', 20000), source('c', 20000)]
  const out = budgetSources(input, { budget: 9000 })
  assert.ok(totalChars(out) <= 9000, `got ${totalChars(out)}`)
})

test('short documents are never cut to make room for long ones', () => {
  // The whole reason allocation is water-filling rather than an even split: an
  // even split would truncate a 700-char review to reserve space a 30,000-char
  // essay was never going to be allowed to use.
  const short = source('short', 700)
  const long = source('long', 40000)
  const out = budgetSources([short, long], { budget: 6000 })

  const returnedShort = out.find((s) => s.title === 'short')
  assert.ok(returnedShort)
  assert.equal(returnedShort.text, short.text)
})

test('documents are dropped whole rather than shredded into fragments', () => {
  // Eight fragments are worse input than two articles, and they also lie to
  // decideAnalysisFloor, which counts sources.
  const input = Array.from({ length: 8 }, (_, i) => source(`doc${i}`, 5000))
  const out = budgetSources(input, { budget: MIN_SUBSTANTIVE_SOURCE_CHARS * 2 })

  assert.equal(out.length, 2)
  for (const s of out) {
    assert.ok(
      s.text.length >= MIN_SUBSTANTIVE_SOURCE_CHARS * 0.5,
      'a kept document should still be a document'
    )
  }
})

test('what survives is what search ranked first', () => {
  const input = [source('first', 5000), source('second', 5000), source('third', 5000)]
  const out = budgetSources(input, { budget: MIN_SUBSTANTIVE_SOURCE_CHARS * 2 })
  assert.deepEqual(
    out.map((s) => s.title),
    ['first', 'second']
  )
})

test('original order is preserved even though allocation sorts by length', () => {
  const input = [source('long', 8000), source('tiny', 700), source('mid', 3000)]
  const out = budgetSources(input, { budget: 9000 })
  assert.deepEqual(
    out.map((s) => s.title),
    ['long', 'tiny', 'mid']
  )
})

test('the truncation marker appears only on documents actually cut', () => {
  // Same lesson as clip() in the explanation prompt: a complete document
  // presented as though it trailed off invites the model to continue it.
  const out = budgetSources([source('tiny', 700), source('huge', 40000)], { budget: 6000 })
  const tiny = out.find((s) => s.title === 'tiny')
  const huge = out.find((s) => s.title === 'huge')

  assert.ok(tiny && !tiny.text.includes('truncated'))
  assert.ok(huge && huge.text.includes('truncated'))
})

test('empty input and a zero budget both yield nothing', () => {
  assert.deepEqual(budgetSources([], { budget: 10000 }), [])
  assert.deepEqual(budgetSources([source('a', 1000)], { budget: 0 }), [])
})

test('documents with no text are dropped before allocation', () => {
  // Otherwise a failed scrape would take a share of the budget and return an
  // empty slot the prompt builder then has to filter again.
  const out = budgetSources([source('real', 900), { title: 'x', domain: 'x.org', text: '' }], {
    budget: 5000,
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].title, 'real')
})

test('one over-long document is clipped rather than dropped', () => {
  // Keeping at least one is deliberate: if the budget is so small that even
  // that lands under the floor's threshold, the floor declines it — which is
  // the right outcome, reached honestly rather than by returning nothing here.
  const out = budgetSources([source('huge', 50000)], { budget: 4000 })
  assert.equal(out.length, 1)
  assert.ok(out[0].text.length <= 4000)
})
