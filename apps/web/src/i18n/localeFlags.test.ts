import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALE_FLAG_COUNTRY, flagCountryFor } from './localeFlags'

const here = dirname(fileURLToPath(import.meta.url))

test('every bundled locale has a flag', () => {
  const locales = readdirSync(join(here, 'locales'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  assert.ok(locales.length > 1)
  for (const code of locales) {
    assert.ok(flagCountryFor(code), `no flag for locale "${code}"`)
  }
})

test('every mapped flag exists in the flag package', () => {
  // A country the package does not export imports as undefined and renders
  // nothing, which no build step reports.
  const types = readFileSync(
    join(here, '../../node_modules/country-flag-icons/react/3x2/index.d.ts'),
    'utf8'
  )
  for (const [locale, country] of Object.entries(LOCALE_FLAG_COUNTRY)) {
    assert.match(types, new RegExp(`export const ${country}: FlagComponent`), `${locale} → ${country}`)
  }
})

test('regional tags fall back to their base language', () => {
  assert.equal(flagCountryFor('el-GR'), 'GR')
  assert.equal(flagCountryFor('EN_us'), 'GB')
  assert.equal(flagCountryFor('xx'), null)
  assert.equal(flagCountryFor(undefined), null)
})

test('LocaleFlag imports every mapped flag', () => {
  // The component imports flags by name to keep the bundle small, so a newly
  // mapped country is a second edit there; without it the code shows instead.
  const source = readFileSync(join(here, '../components/LocaleFlag.tsx'), 'utf8')
  const imported = /import \{([^}]*)\} from 'country-flag-icons\/react\/3x2'/.exec(source)?.[1] ?? ''
  const names = new Set(imported.split(',').map((s) => s.trim()))
  for (const country of new Set(Object.values(LOCALE_FLAG_COUNTRY))) {
    assert.ok(names.has(country), `LocaleFlag.tsx does not import ${country}`)
  }
})
