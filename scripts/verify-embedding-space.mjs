/**
 * Show exactly what Aperture sends to the embedding model, and what comes back.
 *
 * WHY THIS EXISTS. A retrieval mode reaches gemini-embedding-2 as a prefix on
 * the text, not as a request parameter — so "is the mode being applied?" is a
 * question about the bytes being embedded, and a wrong answer is invisible:
 * the vector still has the right width, a unit norm, and plausible neighbours.
 * It just sits in a different space from every row beside it.
 *
 * Running this against the same document a provider-side probe used, and
 * getting the same sha256, proves the whole chain — settings row, invocation,
 * prefix, provider, model — before a full pass commits an hour to it.
 *
 * Reads the LIVE embeddings-role config, so point that at the model and mode
 * you are about to run before using this.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\verify-embedding-space.mjs aperture:/tmp/verify.mjs
 *   docker cp yourdoc.txt aperture:/tmp/doc.txt
 *   docker exec aperture node /tmp/verify.mjs /tmp/doc.txt
 *
 * The file is read as UTF-8 and used verbatim, trailing newline included — a
 * stray newline changes the vector, so compare like with like.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const CORE = '/app/packages/core/dist/index.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: node verify.mjs <path-to-text-file>')
  process.exit(2)
}

const text = readFileSync(path, 'utf8')

const { getEmbeddingInvocation } = await import(CORE)
const inv = await getEmbeddingInvocation()

const sent = inv.prepareText(text)

console.log('--- configuration ---')
console.log('set id     :', inv.setId)
console.log('mode       :', inv.inputType ?? '(none)')
console.log('delivered  :', inv.inputTypeMechanism)
console.log()
console.log('--- text actually embedded ---')
console.log('bytes      :', Buffer.byteLength(sent, 'utf8'))
console.log('prefixed   :', sent !== text ? 'YES' : 'no')
console.log('first 140  :', JSON.stringify(sent.slice(0, 140)))
console.log()

const vector = await inv.embedOne(text)

// float32 little-endian, matching numpy's asarray(v, dtype=float32).tobytes()
const buf = Buffer.from(new Float32Array(vector).buffer)
const norm = Math.sqrt(vector.reduce((acc, x) => acc + x * x, 0))

console.log('--- vector ---')
console.log('dimensions :', vector.length)
console.log('norm       :', norm.toFixed(6))
console.log('sha256     :', createHash('sha256').update(buf).digest('hex'))
