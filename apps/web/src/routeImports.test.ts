import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAZY_LOCALES } from './i18n/localeLoaders'

/**
 * What the first download holds, read off the source.
 *
 * One stray static import undoes a lazy route without anything looking wrong: the
 * page still works, the chunk just moves back into the entry. So this walks the
 * static import graph from main.tsx the way the bundler does and checks what it
 * reaches.
 */

const SRC = dirname(fileURLToPath(import.meta.url))

function resolveModule(specifier: string, from: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = resolve(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier)
  else return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null
}

/** Comments out of the way, so an import shown in prose counts for nothing. */
function readCode(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const STATIC_IMPORT = /^\s*(import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function staticSpecifiers(code: string): string[] {
  return [...code.matchAll(STATIC_IMPORT)].map((match) => match[2])
}

function walkEntry(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const stack = [resolve(SRC, 'main.tsx')]
  while (stack.length > 0) {
    const file = stack.pop() as string
    if (files.has(file)) continue
    files.add(file)
    if (!/\.tsx?$/.test(file)) continue
    for (const specifier of staticSpecifiers(readCode(file))) {
      const target = resolveModule(specifier, file)
      if (target) stack.push(target)
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.add(specifier)
    }
  }
  return { files, packages }
}

const entry = walkEntry()
const label = (file: string) => relative(SRC, file).replace(/\\/g, '/')

function allSourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = resolve(dir, item.name)
    if (item.isDirectory()) return item.name === 'locales' ? [] : allSourceFiles(path)
    return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [path] : []
  })
}

test('the walk really does follow the entry', () => {
  for (const expected of ['App.tsx', 'components/Layout.tsx', 'i18n/config.ts', 'i18n/locales/en/translation.json']) {
    assert.ok(entry.files.has(resolve(SRC, expected)), `${expected} should be reached`)
  }
  assert.ok(entry.packages.has('@mui/material'))
})

test('App.tsx imports no page statically, only the admin route table', () => {
  const eager = staticSpecifiers(readCode(resolve(SRC, 'App.tsx'))).filter((s) => s.startsWith('./pages/'))
  assert.deepEqual(eager, ['./pages/admin/nav/routes'])
})

test('nothing lazily imported is also reachable statically, which would keep it in the entry', () => {
  const undone: string[] = []
  for (const file of entry.files) {
    if (!/\.tsx?$/.test(file)) continue
    for (const match of readCode(file).matchAll(DYNAMIC_IMPORT)) {
      const target = resolveModule(match[1], file)
      if (target && entry.files.has(target)) undone.push(`${label(file)} -> ${label(target)}`)
    }
  }
  assert.deepEqual(undone, [])
})

test('heavy libraries stay out of the entry', () => {
  const heavy = /^(@assistant-ui\/|ai$|recharts|d3|@tiptap\/|@dnd-kit\/|papaparse|react-markdown)/
  assert.deepEqual([...entry.packages].filter((name) => heavy.test(name)), [])
})

test('no locale but English is imported statically, anywhere', () => {
  const nonEnglish = new RegExp(`locales/(${LAZY_LOCALES.join('|')})/translation\\.json`)
  const offenders = allSourceFiles().filter((file) =>
    staticSpecifiers(readCode(file)).some((specifier) => nonEnglish.test(specifier))
  )
  assert.deepEqual(offenders.map(label), [])
  assert.ok(entry.files.has(resolve(SRC, 'i18n/locales/en/translation.json')), 'English is the bundled fallback')
})

test('nothing redraws text by re-setting the language, which would cancel a switch in progress', () => {
  const offenders = allSourceFiles().filter((file) => /changeLanguage\(\s*i18n\.language\s*\)/.test(readCode(file)))
  assert.deepEqual(offenders.map(label), [])
})

test('i18next is told about exactly the languages that exist', () => {
  const config = readCode(resolve(SRC, 'i18n/config.ts'))
  const list = config.match(/supportedLngs:\s*\[([^\]]*)\]/)?.[1] ?? ''
  const declared = [...list.matchAll(/'([a-z]+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual(declared, ['en', ...LAZY_LOCALES].sort())
})
