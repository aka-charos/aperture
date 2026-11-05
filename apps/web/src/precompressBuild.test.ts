import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(WEB_ROOT, 'scripts', 'precompress.mjs')

function inTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'aperture-precompress-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('every chunk gets a brotli and a gzip copy that decode back to it', () => {
  inTempDir((dir) => {
    const source = 'export const text = "Γεια σου, the same words again";\n'.repeat(200)
    writeFileSync(join(dir, 'page-AbCd1234.js'), source)
    execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' })
    assert.equal(brotliDecompressSync(readFileSync(join(dir, 'page-AbCd1234.js.br'))).toString(), source)
    assert.equal(gunzipSync(readFileSync(join(dir, 'page-AbCd1234.js.gz'))).toString(), source)
    assert.equal(readFileSync(join(dir, 'page-AbCd1234.js'), 'utf8'), source, 'the original stays')
  })
})

test('source maps, tiny files and copies that would not be smaller are left alone', () => {
  inTempDir((dir) => {
    writeFileSync(join(dir, 'page-AbCd1234.js.map'), 'x'.repeat(5000))
    writeFileSync(join(dir, 'tiny-AbCd1234.js'), 'export {}\n')
    // Random bytes do not compress.
    writeFileSync(join(dir, 'noise-AbCd1234.js'), Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))))
    execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'pipe' })
    for (const name of ['page-AbCd1234.js.map.br', 'tiny-AbCd1234.js.gz', 'noise-AbCd1234.js.gz']) {
      assert.equal(existsSync(join(dir, name)), false, name)
    }
  })
})

test('a build with no output folder fails rather than shipping uncompressed', () => {
  inTempDir((dir) => {
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, join(dir, 'missing')], { stdio: 'pipe' }))
  })
})

test('the web build runs it', () => {
  const pkg = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.build, /vite build && node scripts\/precompress\.mjs/)
})

// The API caches everything under /assets/ for a year because Vite names it after
// its content. A file from public/ keeps its name, and would be stuck in browsers.
test('nothing with a fixed name lands in /assets/', () => {
  assert.equal(existsSync(join(WEB_ROOT, 'public', 'assets')), false)
})
