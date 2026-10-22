/**
 * Page surfaces read their colours from the theme, so the light mode works.
 *
 * The light mode arrived after a hundred-odd colours had been written straight
 * into components for a dark page: translucent near-black panels, white
 * hairlines, zinc-grey text, MUI's dark greys as fills. Every one of them
 * typechecks, lints and renders perfectly — in the dark mode. In the light
 * mode each is a dark smear on a white sheet or grey text that vanishes, and
 * the first sweep still missed one (the setup page's navy glow). This scan is
 * what keeps the next one out.
 *
 * What it flags is the dark mode's own SURFACE vocabulary, not every literal:
 * black and white overlays on artwork (a badge on a poster, a button on a
 * backdrop) read the same in both modes and are left alone. A colour that
 * belongs to a page surface comes from the theme — a palette path in sx
 * (`'text.secondary'`, `'surface.glass'`) or `theme.palette.surface.*` — and a
 * new one is added to theme.ts for both modes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const UI_SRC = join(SRC, '..', '..', '..', 'packages', 'ui', 'src')

const DARK_ONLY: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /rgba\(\s*(15|18|26|37)\s*,\s*\1\s*,\s*\1\s*,/, what: 'a near-black panel tone' },
  { pattern: /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(05|08|1|12|15)\s*\)/, what: 'a white hairline or hover tint' },
  { pattern: /['"`]#(252525|212121|1a1a2e|16213e)['"`]/i, what: 'a dark surface hex' },
  { pattern: /['"`]#(e4e4e7|d4d4d8|a1a1aa|71717a)['"`]/i, what: 'a zinc text grey tuned for black' },
  { pattern: /['"`]grey\.(800|900)['"`]/, what: "MUI's dark grey as a fill" },
]

/**
 * Files that may use them, each with its reason. A stale entry fails, so a
 * renamed file cannot leave an exemption reading as reviewed.
 */
const ALLOWED: Record<string, string> = {
  'theme.ts': 'defines the dark mode itself',
  'components/SimilarityGraph/SimilarityGraph.tsx': 'draws inside a DarkStage in both modes',
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Every dark-only literal in a source text, as "line: what". */
export function findDarkOnlyColours(source: string): string[] {
  const found: string[] = []
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    for (const { pattern, what } of DARK_ONLY) {
      if (pattern.test(line)) found.push(`${i + 1}: ${what}`)
    }
  })
  return found
}

test('the scanner catches each dark-only shape and ignores artwork overlays', () => {
  assert.equal(findDarkOnlyColours("bgcolor: 'rgba(26, 26, 26, 0.7)',").length, 1)
  assert.equal(findDarkOnlyColours("border: '1px solid rgba(255,255,255,0.1)',").length, 1)
  assert.equal(findDarkOnlyColours("bgcolor: '#252525',").length, 1)
  assert.equal(findDarkOnlyColours("color: '#a1a1aa',").length, 1)
  assert.equal(findDarkOnlyColours("bgcolor: 'grey.900',").length, 1)
  // A scrim on a poster is the same in both modes.
  assert.equal(findDarkOnlyColours("backgroundColor: 'rgba(0, 0, 0, 0.75)',").length, 0)
  assert.equal(findDarkOnlyColours("border: '1.5px solid rgba(255, 255, 255, 0.75)',").length, 0)
  assert.equal(findDarkOnlyColours("// was 'rgba(26, 26, 26, 0.7)'").length, 0)
})

test('page surfaces take their colours from the theme', () => {
  const offenders: string[] = []
  const seenAllowed = new Set<string>()
  for (const [root, label] of [
    [SRC, ''],
    [UI_SRC, '@aperture/ui/'],
  ] as const) {
    for (const file of sourceFiles(root)) {
      const rel = label + relative(root, file).replace(/\\/g, '/')
      if (rel in ALLOWED) {
        seenAllowed.add(rel)
        continue
      }
      for (const hit of findDarkOnlyColours(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${hit}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Dark-only colours on a page surface; read them from the theme (see theme.ts SurfaceTokens):\n' +
      offenders.join('\n')
  )
  const stale = Object.keys(ALLOWED).filter((rel) => !seenAllowed.has(rel))
  assert.deepEqual(stale, [], `Exemptions naming files that no longer exist: ${stale.join(', ')}`)
})

/**
 * Every light colour comes from the one scheme object.
 *
 * The light mode is a single `LightScheme` (`LIGHT_SCHEME` in theme.ts) so that
 * changing the light palette is changing one object, judged on a rendered screen.
 * That only holds while nothing else names a colour: the first version carried a
 * cool grey input-hover outline inside the light options, left over from a
 * palette that had already been replaced, and the address-bar colour was a copy
 * in lib/colorMode.ts that had to be retyped by hand three times. Two checks:
 * the light builders in theme.ts name no literal colour, and no other file
 * repeats one of the scheme's own values.
 */
const THEME = join(SRC, 'theme.ts')
const LIGHT_BUILDERS = ['lightPaletteFor', 'lightBrand', 'lightSurfaces', 'lightNav', 'lightShadows', 'buildLightOptions']
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(/i

/** The body of a top-level `function name(…)` in a source text, braces matched. */
export function functionBody(source: string, name: string): string | null {
  const head = source.indexOf(`function ${name}(`)
  if (head < 0) return null
  // Past the parameter list (which may hold an object type's braces), then the
  // first brace after it opens the body; a return type here is a bare name.
  let parens = 0
  let close = -1
  for (let i = source.indexOf('(', head); i < source.length; i++) {
    if (source[i] === '(') parens++
    else if (source[i] === ')' && --parens === 0) {
      close = i
      break
    }
  }
  const open = close < 0 ? -1 : source.indexOf('{', close)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1)
  }
  return null
}

/** The hex values written inside the `LIGHT_SCHEME` object. */
export function schemeHexes(source: string): string[] {
  const start = source.indexOf('const LIGHT_SCHEME: LightScheme = {')
  if (start < 0) return []
  const end = source.indexOf('\n}\n', start)
  return [...source.slice(start, end).matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1].toLowerCase())
}

test('the body finder and the scheme reader read what they claim to', () => {
  const src = 'function a(x: { y: string }): T {\n  return { z: `${x}` }\n}\nfunction b() {}'
  assert.equal(functionBody(src, 'a'), '{\n  return { z: `${x}` }\n}')
  assert.equal(functionBody(src, 'missing'), null)
  assert.deepEqual(schemeHexes("const LIGHT_SCHEME: LightScheme = {\n  ink: '#2A1C16',\n}\n"), ['#2a1c16'])
})

test('the light builders take every colour from the scheme', () => {
  const source = readFileSync(THEME, 'utf8')
  const offenders: string[] = []
  for (const name of LIGHT_BUILDERS) {
    const body = functionBody(source, name)
    assert.ok(body, `theme.ts no longer has function ${name}; update LIGHT_BUILDERS`)
    body.split('\n').forEach((line, i) => {
      if (!/^\s*(\/\/|\*)/.test(line) && COLOUR_LITERAL.test(line)) offenders.push(`${name} +${i}: ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [], 'A light colour that is not a field of LightScheme:\n' + offenders.join('\n'))
})

test("no other file repeats one of the light scheme's values", () => {
  const hexes = schemeHexes(readFileSync(THEME, 'utf8')).filter((hex) => hex !== '#ffffff' && hex !== '#000000')
  assert.ok(hexes.length >= 10, 'could not read LIGHT_SCHEME out of theme.ts')
  const offenders: string[] = []
  for (const [root, label] of [
    [SRC, ''],
    [UI_SRC, '@aperture/ui/'],
  ] as const) {
    for (const file of sourceFiles(root)) {
      if (file === THEME) continue
      const text = readFileSync(file, 'utf8').toLowerCase()
      for (const hex of hexes) {
        if (text.includes(hex)) offenders.push(`${label}${relative(root, file).replace(/\\/g, '/')}: ${hex}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'A copy of a light scheme colour; read it from the theme instead:\n' + offenders.join('\n'))
})
