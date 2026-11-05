// Writes a .br and a .gz beside each script and stylesheet in the build, for the
// API to send as they are (`preCompressed` in apps/api/src/plugins/static.ts).
// Compressing here rather than per request gets the highest settings, costs the
// server nothing, and leaves API responses alone: a compression layer over those
// would have to be kept off the chat stream and the job progress stream.
//
// Usage: node scripts/precompress.mjs [assetsDir]
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

const COMPRESSIBLE = new Set(['.js', '.css', '.svg', '.json'])
// Below this a compressed copy saves less than the headers around it. Source maps
// are left out on purpose: only an open devtools panel ever asks for one.
const MIN_BYTES = 1024

const dir = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../dist/assets', import.meta.url))

async function writeIfSmaller(path, compressed, original) {
  if (compressed.length >= original.length) return 0
  await writeFile(path, compressed)
  return compressed.length
}

async function compressOne(path) {
  const source = await readFile(path)
  const [br, gzipped] = await Promise.all([
    brotli(source, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
    gz(source, { level: constants.Z_BEST_COMPRESSION }),
  ])
  return {
    raw: source.length,
    br: (await writeIfSmaller(`${path}.br`, br, source)) || source.length,
    gz: (await writeIfSmaller(`${path}.gz`, gzipped, source)) || source.length,
  }
}

async function main() {
  const started = Date.now()
  const names = await readdir(dir)
  const eligible = []
  for (const name of names) {
    if (!COMPRESSIBLE.has(extname(name))) continue
    const path = join(dir, name)
    const info = await stat(path)
    if (info.isFile() && info.size >= MIN_BYTES) eligible.push(path)
  }
  // zlib runs on the thread pool, which is what limits how many run at once.
  const results = await Promise.all(eligible.map(compressOne))
  const total = (key) => results.reduce((sum, result) => sum + result[key], 0)
  const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`
  console.log(
    `precompress: ${results.length} files, ${mb(total('raw'))} -> ${mb(total('br'))} br, ` +
      `${mb(total('gz'))} gzip, in ${((Date.now() - started) / 1000).toFixed(1)}s`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
