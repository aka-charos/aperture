/**
 * The Search page's two passes, as one pure sequence (searchPasses.test.ts).
 *
 * Embedding the query is the slow step of a semantic search, and the title
 * matches need none. So the semantic request goes first and gets a short head
 * start (SEMANTIC_GRACE_MS); answered in time, it is shown alone, with no
 * second request and nothing reordering on screen. Slower than that, the plain
 * title search goes out and is shown as PROVISIONAL (the page dims it and
 * takes no clicks, so a click cannot land on a poster the semantic answer then
 * moves), and the semantic answer replaces it. A semantic failure keeps the
 * title matches and says so, never passing them off as semantic.
 */

export const SEMANTIC_GRACE_MS = 400

/** A failure: refused by the server, or no answer at all. */
export type ReadFailure = 'failed' | 'unreachable'
export type ReadResult<A> = A | ReadFailure

export type Ranking = 'title' | 'semantic'

export interface SearchPassOutcome {
  /** shown: some answer is on screen; otherwise why nothing is. */
  status: 'shown' | ReadFailure | 'aborted'
  /** Semantic was asked for and did not answer: what is shown is title matches. */
  semanticFailed: boolean
}

const isFailure = <A>(r: ReadResult<A> | typeof PENDING): r is ReadFailure =>
  r === 'failed' || r === 'unreachable'

const PENDING = Symbol('pending')

export async function runSearchPasses<A>(options: {
  readTitle: () => Promise<ReadResult<A>>
  /** Null when semantic search is off. */
  readSemantic: (() => Promise<ReadResult<A>>) | null
  aborted: () => boolean
  /** `provisional`: shown while a better answer is still coming. */
  show: (answer: A, ranking: Ranking, provisional: boolean) => void
  graceMs?: number
  wait?: (ms: number) => Promise<void>
}): Promise<SearchPassOutcome> {
  const { readTitle, readSemantic, aborted, show } = options
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  if (!readSemantic) {
    const title = await readTitle()
    if (aborted()) return { status: 'aborted', semanticFailed: false }
    if (isFailure(title)) return { status: title, semanticFailed: false }
    show(title, 'title', false)
    return { status: 'shown', semanticFailed: false }
  }

  const semantic = readSemantic()
  const early: ReadResult<A> | typeof PENDING = await Promise.race([
    semantic,
    wait(options.graceMs ?? SEMANTIC_GRACE_MS).then((): typeof PENDING => PENDING),
  ])
  if (aborted()) return { status: 'aborted', semanticFailed: false }
  if (early !== PENDING && !isFailure(early)) {
    show(early as A, 'semantic', false)
    return { status: 'shown', semanticFailed: false }
  }

  // Slow, or already failed: the title matches now.
  const stillComing = early === PENDING
  const title = await readTitle()
  if (aborted()) return { status: 'aborted', semanticFailed: false }
  if (!isFailure(title)) show(title, 'title', stillComing)

  const late = stillComing ? await semantic : (early as ReadFailure)
  if (aborted()) return { status: 'aborted', semanticFailed: false }
  if (!isFailure(late)) {
    show(late, 'semantic', false)
    return { status: 'shown', semanticFailed: false }
  }
  if (!isFailure(title)) {
    // Shown again as final: the title matches are the answer now.
    show(title, 'title', false)
    return { status: 'shown', semanticFailed: true }
  }
  // Neither answered. A refusal says more than silence.
  return { status: late === 'failed' || title === 'failed' ? 'failed' : 'unreachable', semanticFailed: true }
}
