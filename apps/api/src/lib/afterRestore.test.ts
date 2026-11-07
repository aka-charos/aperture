import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { MIGRATIONS_DIR } from './afterRestore.js'

test('the restore migrates from the folder that holds the migrations', () => {
  assert.ok(readdirSync(MIGRATIONS_DIR).some((name) => name.startsWith('0002_')))
})
