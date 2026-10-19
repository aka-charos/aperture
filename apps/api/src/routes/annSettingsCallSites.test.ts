/**
 * Only core's `scopedAnnSettings` (lib/libraryScope.ts) sets pgvector's HNSW
 * scan options; everything else goes through `scopedAnnQuery`.
 *
 * Each nearest-neighbour site used to write its own `SET LOCAL hnsw.ef_search =
 * 500`, and at 500 the planner priced the index above a full scan, so similar
 * titles, semantic search and the assistant's scored pool each seq-scanned every
 * embedding set (1.5-4.7 s, against milliseconds through the index with an
 * iterative scan). Five copies of one setting is how it spread, so this scan
 * fails on any source file outside libraryScope.ts that assigns an `hnsw.*`
 * option, in either package.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_SRC = fileURLToPath(new URL('..', import.meta.url))
const CORE_SRC = fileURLToPath(new URL('../../../../packages/core/src', import.meta.url))

/** The one file allowed to choose HNSW scan settings. */
const OWNER = ['lib', 'libraryScope.ts'].join(sep)

/** An assignment to an hnsw option, by SET or by set_config. */
const SETS_HNSW = /\bhnsw\.[a-z_]+\s*(?:=|\bTO\b)|set_config\(\s*'hnsw\./i

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** Lines that assign an hnsw option, with comment lines left out. */
function hnswAssignments(text: string): number[] {
  const hits: number[] = []
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (SETS_HNSW.test(line)) hits.push(i + 1)
  })
  return hits
}

test('the scan recognises both ways of setting an hnsw option', () => {
  assert.deepEqual(hnswAssignments("await client.query(`SET LOCAL hnsw.ef_search = ${N}`)"), [1])
  assert.deepEqual(hnswAssignments("SELECT set_config('hnsw.iterative_scan', 'strict_order', true)"), [1])
  assert.deepEqual(hnswAssignments('SET hnsw.ef_search TO 200'), [1])
  assert.deepEqual(hnswAssignments(' * the `SET LOCAL hnsw.ef_search = 500` this replaced'), [])
  assert.deepEqual(hnswAssignments('// SET LOCAL hnsw.ef_search = 500'), [])
})

test('no file outside libraryScope.ts sets an hnsw option', () => {
  const violations: string[] = []
  for (const [root, label] of [
    [API_SRC, 'apps/api/src'],
    [CORE_SRC, 'packages/core/src'],
  ] as const) {
    const files = sourceFiles(root)
    // A floor, so a moved directory cannot turn this into a scan of nothing.
    assert.ok(files.length > 50, `expected source files under ${label}, found ${files.length}`)
    for (const file of files) {
      const rel = relative(root, file)
      if (root === CORE_SRC && rel === OWNER) continue
      for (const line of hnswAssignments(readFileSync(file, 'utf8'))) {
        violations.push(`${label}/${rel.split(sep).join('/')}:${line}`)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'Set HNSW scan options only in core lib/libraryScope.ts; run the query through scopedAnnQuery'
  )
})

test('the owner file is where the scan says it is', () => {
  const owner = readFileSync(join(CORE_SRC, OWNER), 'utf8')
  assert.ok(hnswAssignments(owner).length > 0, 'libraryScope.ts no longer sets hnsw options; update OWNER')
})
