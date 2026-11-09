import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REACH_LEVELS, reachStep } from './reachScale'

const here = dirname(fileURLToPath(import.meta.url))

test('each level fills up to its place on the scale', () => {
  assert.deepEqual(
    REACH_LEVELS.map((level) => reachStep(level)?.step),
    [1, 2, 3, 4]
  )
})

test('no level, or one this build does not know, draws no scale', () => {
  assert.equal(reachStep(undefined), null)
  assert.equal(reachStep(null), null)
  assert.equal(reachStep('everyone'), null)
})

test('every level has a name and a hint in English', () => {
  const en = JSON.parse(readFileSync(join(here, '../../i18n/locales/en/translation.json'), 'utf8'))
  for (const level of REACH_LEVELS) {
    assert.ok(en.mediaDetail.infoCard.reachLevel[level], `name for ${level}`)
    assert.ok(en.mediaDetail.infoCard.reachHint[level], `hint for ${level}`)
  }
})
