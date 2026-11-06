/**
 * The restore and the dump, against stand-in programs. What is pinned is the part
 * that protects the data: a backup that could not be read never reaches psql, a
 * dump that failed is never published, and psql is only ever asked for one
 * transaction that stops at the first error.
 *
 * Not a test of PostgreSQL. No real server or client is involved here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  BackupCancelledError,
  isDatabaseRestoring,
  restoreInTransaction,
  withoutTransactionTimeout,
  writeArchive,
} from './restore.js'

const DB = { host: 'db', port: '5432', user: 'app', database: 'aperture', password: 'secret' }

const DUMP_HEADER = [
  '--',
  '-- PostgreSQL database dump',
  '--',
  '',
  'SET statement_timeout = 0;',
  'SET lock_timeout = 0;',
  'SET transaction_timeout = 0;',
  "SET client_encoding = 'UTF8';",
  '',
].join('\n')

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'aperture-restore-test-'))
  const scratchRoot = join(dir, 'backups')
  mkdirSync(scratchRoot)
  // Records how it was called and the SQL it was handed, then exits as told.
  const psqlScript = join(dir, 'psql.mjs')
  writeFileSync(
    psqlScript,
    `import { readFileSync, writeFileSync } from 'node:fs'
     const args = process.argv.slice(2)
     const sql = readFileSync(args[args.indexOf('-f') + 1], 'utf8')
     writeFileSync(process.env.RESTORE_TEST_LOG, JSON.stringify({ args, sql, password: process.env.PGPASSWORD }))
     if (process.env.RESTORE_TEST_PSQL_FAILS) { console.error('ERROR: boom'); process.exit(3) }
    `
  )
  const pgRestoreScript = (body: string) => {
    const file = join(dir, 'pg_restore.mjs')
    writeFileSync(file, body)
    return [process.execPath, file]
  }
  const log = join(dir, 'psql.log')
  process.env.RESTORE_TEST_LOG = log
  delete process.env.RESTORE_TEST_PSQL_FAILS
  return {
    dir,
    scratchRoot,
    log,
    psql: [process.execPath, psqlScript],
    pgRestoreScript,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

async function collect(source: AsyncIterable<Buffer>): Promise<string> {
  let out = ''
  for await (const chunk of source) out += chunk.toString()
  return out
}

async function* chunks(...parts: string[]): AsyncGenerator<Buffer> {
  for (const part of parts) yield Buffer.from(part)
}

test('the transaction_timeout line leaves a dump header, whatever chunks it arrives in', async () => {
  const body = `${DUMP_HEADER}CREATE TABLE t (id int);\n`
  const cleaned = await collect(withoutTransactionTimeout(chunks(body.slice(0, 40), body.slice(40))))
  assert.ok(!cleaned.includes('transaction_timeout'))
  assert.ok(cleaned.includes('SET lock_timeout = 0;'))
  assert.ok(cleaned.endsWith('CREATE TABLE t (id int);\n'))
})

test('data holding the same words is left alone', async () => {
  const data = 'SET transaction_timeout = 0;\nnot a dump header\n'
  assert.equal(await collect(withoutTransactionTimeout(chunks(data))), data)

  const late = `${DUMP_HEADER}${'x'.repeat(5000)}\nSET transaction_timeout = 0;\n`
  assert.ok((await collect(withoutTransactionTimeout(chunks(late)))).endsWith('SET transaction_timeout = 0;\n'))
})

test('an archive is applied by psql as one transaction that stops at the first error', async () => {
  const s = sandbox()
  try {
    const pgRestore = s.pgRestoreScript(`process.stdout.write(${JSON.stringify(`${DUMP_HEADER}SELECT 1;\n`)})`)
    const backup = join(s.scratchRoot, 'a.dump')
    writeFileSync(backup, 'PGDMP')

    let sawApplying = false
    await restoreInTransaction(backup, DB, {
      scratchRoot: s.scratchRoot,
      commands: { pgRestore, psql: s.psql },
      onApplying: () => { sawApplying = true },
    })

    const call = JSON.parse(readFileSync(s.log, 'utf8'))
    assert.ok(call.args.includes('--single-transaction'))
    assert.ok(call.args.includes('ON_ERROR_STOP=1'))
    assert.equal(call.password, 'secret')
    assert.ok(call.sql.endsWith('SELECT 1;\n'))
    assert.ok(!call.sql.includes('transaction_timeout'))
    assert.ok(sawApplying)
  } finally {
    s.cleanup()
  }
})

test('a backup that cannot be read never reaches psql', async () => {
  const s = sandbox()
  try {
    // Writes some SQL, then fails: through a pipe this would have read as a
    // clean end of input and committed the truncated restore.
    const pgRestore = s.pgRestoreScript(
      `process.stdout.write('SELECT 1;\\n'); console.error('pg_restore: error: bad block'); process.exitCode = 1`
    )
    const backup = join(s.scratchRoot, 'a.dump')
    writeFileSync(backup, 'PGDMP')

    await assert.rejects(
      restoreInTransaction(backup, DB, { scratchRoot: s.scratchRoot, commands: { pgRestore, psql: s.psql } }),
      /pg_restore exited with 1: pg_restore: error: bad block/
    )
    assert.equal(existsSync(s.log), false, 'psql ran')
    assert.equal(isDatabaseRestoring(), false)
  } finally {
    s.cleanup()
  }
})

test('a corrupt gzip file never reaches psql', async () => {
  const s = sandbox()
  try {
    const backup = join(s.scratchRoot, 'a.sql.gz')
    writeFileSync(backup, gzipSync('SELECT 1;\n').subarray(0, 12))
    await assert.rejects(
      restoreInTransaction(backup, DB, {
        scratchRoot: s.scratchRoot,
        commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
      })
    )
    assert.equal(existsSync(s.log), false, 'psql ran')
  } finally {
    s.cleanup()
  }
})

test('a plain or gzipped SQL backup goes through the same transaction', async () => {
  const s = sandbox()
  try {
    const gz = join(s.scratchRoot, 'a.sql.gz')
    writeFileSync(gz, gzipSync(`${DUMP_HEADER}SELECT 2;\n`))
    await restoreInTransaction(gz, DB, {
      scratchRoot: s.scratchRoot,
      commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
    })
    const call = JSON.parse(readFileSync(s.log, 'utf8'))
    assert.ok(call.args.includes('--single-transaction'))
    assert.ok(call.sql.endsWith('SELECT 2;\n'))
  } finally {
    s.cleanup()
  }
})

test('a failed psql is reported, and nothing is left behind or locked', async () => {
  const s = sandbox()
  try {
    process.env.RESTORE_TEST_PSQL_FAILS = '1'
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, 'SELECT 3;\n')
    // Left by a process that died mid-restore.
    mkdirSync(join(s.scratchRoot, '.restore-orphan'))
    writeFileSync(join(s.scratchRoot, '.restore-orphan', 'restore.sql'), 'old')

    await assert.rejects(
      restoreInTransaction(backup, DB, {
        scratchRoot: s.scratchRoot,
        commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
      }),
      /psql exited with 3: ERROR: boom/
    )
    assert.equal(isDatabaseRestoring(), false)
    assert.deepEqual(readdirSync(s.scratchRoot), ['a.sql'])
  } finally {
    s.cleanup()
  }
})

test('the database reads as restoring only while psql runs, and only one restore runs', async () => {
  const s = sandbox()
  try {
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, 'SELECT 4;\n')
    const commands = { pgRestore: s.pgRestoreScript(''), psql: s.psql }

    let duringApply: boolean | null = null
    const first = restoreInTransaction(backup, DB, {
      scratchRoot: s.scratchRoot,
      commands,
      onApplying: () => { queueMicrotask(() => { duringApply = isDatabaseRestoring() }) },
    })
    await assert.rejects(
      restoreInTransaction(backup, DB, { scratchRoot: s.scratchRoot, commands }),
      /already running/
    )
    assert.equal(isDatabaseRestoring(), false, 'reading the file locks nothing')
    await first
    assert.equal(duringApply, true)
    assert.equal(isDatabaseRestoring(), false)
  } finally {
    s.cleanup()
  }
})

function fakeDump(script: string) {
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
}

test('a finished dump is published under its real name', async () => {
  const s = sandbox()
  try {
    const file = join(s.scratchRoot, 'a.dump')
    await writeArchive(fakeDump(`process.stdout.write('PGDMP and the rest')`), file)
    assert.equal(readFileSync(file, 'utf8'), 'PGDMP and the rest')
    assert.deepEqual(readdirSync(s.scratchRoot), ['a.dump'])
  } finally {
    s.cleanup()
  }
})

test('a dump that fails after writing is not published, even with a valid start', async () => {
  const s = sandbox()
  try {
    await assert.rejects(
      writeArchive(
        fakeDump(`process.stdout.write('PGDMP half'); console.error('pg_dump: error: gone'); process.exitCode = 1`),
        join(s.scratchRoot, 'a.dump')
      ),
      /pg_dump exited with 1: pg_dump: error: gone/
    )
    assert.deepEqual(readdirSync(s.scratchRoot), [])
  } finally {
    s.cleanup()
  }
})

test('output that is not an archive is not published', async () => {
  const s = sandbox()
  try {
    await assert.rejects(
      writeArchive(fakeDump(`process.stdout.write('hello')`), join(s.scratchRoot, 'a.dump')),
      /valid archive/
    )
    assert.deepEqual(readdirSync(s.scratchRoot), [])
  } finally {
    s.cleanup()
  }
})

test('a cancelled dump says so and leaves no file', async () => {
  const s = sandbox()
  try {
    await assert.rejects(
      writeArchive(fakeDump(`process.stdout.write('PGDMP')`), join(s.scratchRoot, 'a.dump'), () => true),
      BackupCancelledError
    )
    assert.deepEqual(readdirSync(s.scratchRoot), [])
  } finally {
    s.cleanup()
  }
})

test('two dumps cannot write the same name', async () => {
  const s = sandbox()
  try {
    const file = join(s.scratchRoot, 'a.dump')
    writeFileSync(`${file}.partial`, 'someone else is writing')
    await assert.rejects(writeArchive(fakeDump(`process.stdout.write('PGDMP')`), file))
    assert.equal(existsSync(file), false)
  } finally {
    s.cleanup()
  }
})
