import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runSearchPasses, type ReadResult, type Ranking } from './searchPasses'

type Shown = Array<[string, Ranking, boolean]>

/** A read that answers after `ms` with `value`. */
const after =
  <A>(ms: number, value: ReadResult<A>) =>
  () =>
    new Promise<ReadResult<A>>((resolve) => setTimeout(() => resolve(value), ms))

async function run(options: {
  title: () => Promise<ReadResult<string>>
  semantic: (() => Promise<ReadResult<string>>) | null
  aborted?: () => boolean
}) {
  const shown: Shown = []
  let titleAsked = 0
  const outcome = await runSearchPasses<string>({
    readTitle: () => {
      titleAsked++
      return options.title()
    },
    readSemantic: options.semantic,
    aborted: options.aborted ?? (() => false),
    show: (answer, ranking, provisional) => shown.push([answer, ranking, provisional]),
    graceMs: 50,
  })
  return { outcome, shown, titleAsked }
}

describe('runSearchPasses', () => {
  it('semantic off: one title request, shown as final', async () => {
    const r = await run({ title: after(0, 'T'), semantic: null })
    assert.deepEqual(r.shown, [['T', 'title', false]])
    assert.deepEqual(r.outcome, { status: 'shown', semanticFailed: false })
  })

  it('a quick semantic answer is shown alone, and no title request is sent', async () => {
    const r = await run({ title: after(0, 'T'), semantic: after(10, 'S') })
    assert.deepEqual(r.shown, [['S', 'semantic', false]])
    assert.equal(r.titleAsked, 0)
  })

  it('a slow semantic answer: title matches first as provisional, then replaced', async () => {
    const r = await run({ title: after(5, 'T'), semantic: after(120, 'S') })
    assert.deepEqual(r.shown, [
      ['T', 'title', true],
      ['S', 'semantic', false],
    ])
    assert.deepEqual(r.outcome, { status: 'shown', semanticFailed: false })
  })

  it('a slow semantic failure keeps the title matches and says semantic failed', async () => {
    const r = await run({ title: after(5, 'T'), semantic: after(120, 'failed') })
    assert.deepEqual(r.shown, [
      ['T', 'title', true],
      ['T', 'title', false],
    ])
    assert.deepEqual(r.outcome, { status: 'shown', semanticFailed: true })
  })

  it('a quick semantic failure falls back to the title matches, not provisional', async () => {
    const r = await run({ title: after(5, 'T'), semantic: after(1, 'unreachable') })
    assert.deepEqual(r.shown, [
      ['T', 'title', false],
      ['T', 'title', false],
    ])
    assert.equal(r.outcome.semanticFailed, true)
  })

  it('nothing answers: a refusal is reported over silence', async () => {
    const r = await run({ title: after(5, 'unreachable'), semantic: after(1, 'failed') })
    assert.deepEqual(r.shown, [])
    assert.deepEqual(r.outcome, { status: 'failed', semanticFailed: true })
  })

  it('an aborted search shows nothing more', async () => {
    let aborted = false
    const r = await run({
      title: async () => {
        aborted = true
        return 'T'
      },
      semantic: after(120, 'S'),
      aborted: () => aborted,
    })
    assert.deepEqual(r.shown, [])
    assert.equal(r.outcome.status, 'aborted')
  })
})
