import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Nothing may call the AI SDK's `embed` / `embedMany` except the one function
 * that knows which space it is embedding into.
 *
 * WHY A SOURCE SCAN. A retrieval mode reaches gemini-embedding-2 as a TEXT
 * PREFIX on the document, not as a parameter — so producing a vector correctly
 * means transforming the input, and a call site that embeds raw text produces a
 * vector in a different space with the right width, a unit norm, and plausible
 * neighbours. Nothing downstream can tell. TypeScript cannot help either: an
 * unused `prepareText` is not a type error.
 *
 * The count is the argument. There were ELEVEN embed call sites across core and
 * the API when this was written, spread over the recommender, the similarity
 * graph, three assistant tools, two settings handlers and the global search
 * route — and one of them (`routes/search/index.ts`) was missed twice while
 * enumerating them by hand. A convention would not have survived that.
 *
 * So `getEmbeddingInvocation` returns `embedOne` / `embedBatch`, which apply the
 * prefix internally, and this test keeps them the only door.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')

const SCANNED_ROOTS = [
  join(REPO_ROOT, 'packages', 'core', 'src'),
  join(REPO_ROOT, 'apps', 'api', 'src'),
]

/**
 * The one file allowed to reach the SDK directly: it is where the space is
 * decided, so it is the only place that can honour it.
 */
const EMBEDDING_GATEWAY = join('packages', 'core', 'src', 'lib', 'ai-provider.ts')

/** `embed({`, `embedMany({`, and the destructured/awaited forms of each. */
const DIRECT_CALL = /\b(embed|embedMany)\s*\(\s*\{/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      yield full
    }
  }
}

test('only the embedding gateway calls the AI SDK embed functions directly', () => {
  const offenders: string[] = []

  for (const root of SCANNED_ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(REPO_ROOT, file)
      if (rel === EMBEDDING_GATEWAY) continue
      if (rel.endsWith('.test.ts')) continue

      const source = readFileSync(file, 'utf8')
      for (const [index, line] of source.split('\n').entries()) {
        if (DIRECT_CALL.test(line)) offenders.push(`${rel}:${index + 1}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These call the AI SDK directly and so skip the task prefix. Use ' +
      'getEmbeddingInvocation()\'s embedOne / embedBatch instead:\n  ' +
      offenders.join('\n  ')
  )
})

test('the scan actually reaches the files it claims to', () => {
  // A walk that silently found nothing would make the test above pass forever.
  const files = SCANNED_ROOTS.flatMap((root) => [...walk(root)])
  assert.ok(files.length > 500, `expected to scan the whole tree, saw ${files.length} files`)
  assert.ok(
    files.some((f) => relative(REPO_ROOT, f) === EMBEDDING_GATEWAY),
    'the gateway itself was not reached, so the exclusion proves nothing'
  )
  assert.ok(
    files.some((f) => f.endsWith(join('routes', 'search', 'index.ts'))),
    'the API route that was missed twice by hand is not being scanned'
  )
})
