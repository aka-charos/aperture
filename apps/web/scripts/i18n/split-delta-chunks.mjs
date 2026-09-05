#!/usr/bin/env node
/**
 * Splits scripts/i18n/delta/missing-from-en.json into chunk-NN.json files
 * (~18–22KB serialized per chunk) for batched translation.
 *
 * Chunks come out viewer-facing first. Roughly half the catalogue is admin
 * console copy that only ever renders for one or two people on an instance,
 * so a batch that runs out of budget, patience or context should run out of
 * it there rather than halfway through the pages every viewer sees. The
 * audience of each namespace is declared in src/i18n/audience.ts and pinned
 * by its test — hence the tsx import, so there is one copy of that list.
 *
 * Usage: node --import tsx split-delta-chunks.mjs
 */
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { namespaceAudience } from '../../src/i18n/audience.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const deltaDir = join(__dirname, 'delta')
const src = join(deltaDir, 'missing-from-en.json')
const MAX_CHUNK = 20 * 1024

const d = JSON.parse(fs.readFileSync(src, 'utf8'))

// Stable within an audience: the delta already follows the English file's
// order, and reshuffling it would make two runs of the same gap produce
// unrelated chunk boundaries.
const keys = Object.keys(d)
const ordered = [
  ...keys.filter((k) => namespaceAudience(k) === 'user'),
  ...keys.filter((k) => namespaceAudience(k) === 'admin'),
]

let cur = {}
let audiences = new Set()
let size = 0
let n = 1

function flush() {
  if (Object.keys(cur).length === 0) return
  const out = join(deltaDir, `chunk-${String(n).padStart(2, '0')}.json`)
  fs.writeFileSync(out, JSON.stringify(cur, null, 2) + '\n', 'utf8')
  const audience = audiences.size === 1 ? [...audiences][0] : 'mixed'
  console.log(out, fs.statSync(out).size, 'keys', Object.keys(cur).length, 'audience', audience)
  n++
  cur = {}
  audiences = new Set()
  size = 0
}

for (const k of ordered) {
  const part = { [k]: d[k] }
  const add = JSON.stringify(part).length
  if (size + add > MAX_CHUNK && Object.keys(cur).length > 0) {
    flush()
  }
  cur[k] = d[k]
  audiences.add(namespaceAudience(k))
  size += add
}
flush()

const bytes = (list) => list.reduce((s, k) => s + JSON.stringify({ [k]: d[k] }).length, 0)
const user = keys.filter((k) => namespaceAudience(k) === 'user')
const admin = keys.filter((k) => namespaceAudience(k) === 'admin')
console.log(`\nviewer-facing: ${user.length} namespaces, ~${Math.round(bytes(user) / 1024)}KB (translate these first)`)
console.log(`admin console: ${admin.length} namespaces, ~${Math.round(bytes(admin) / 1024)}KB`)
