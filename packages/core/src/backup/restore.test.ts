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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import {
  BackupCancelledError,
  BackupUploadTooLargeError,
  CLEAR_SCHEMA_SQL,
  claimRestore,
  describeRestoreFailure,
  isDatabaseRestoring,
  isRestoreInProgress,
  releaseRestore,
  removeAbandonedPartials,
  restoreInTransaction,
  withoutExtensionOwnership,
  withoutHeaderTimeouts,
  writeArchive,
  writeBackupUpload,
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
  'DROP TABLE IF EXISTS public.users;',
  'DROP EXTENSION IF EXISTS vector;',
  'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;',
  "COMMENT ON EXTENSION vector IS 'vector data type';",
  'CREATE TABLE public.aperture_migrations (id integer);',
  'CREATE TABLE public.users (id integer);',
  '',
].join('\n')

const DUMP_FOOTER = '\n--\n-- PostgreSQL database dump complete\n--\n\n'

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
     if (process.env.RESTORE_TEST_PSQL_FAILS) { console.error(process.env.RESTORE_TEST_PSQL_STDERR ?? 'ERROR: boom'); process.exit(3) }
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
  delete process.env.RESTORE_TEST_PSQL_STDERR
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

test('both timeout lines leave a dump header, whatever chunks it arrives in', async () => {
  const body = `${DUMP_HEADER}CREATE TABLE t (id int);\n`
  const cleaned = await collect(withoutHeaderTimeouts(chunks(body.slice(0, 40), body.slice(40))))
  assert.ok(!cleaned.includes('transaction_timeout'))
  assert.ok(!cleaned.includes('lock_timeout'), 'it would switch off the bound on waiting for a lock')
  assert.ok(cleaned.includes('SET statement_timeout = 0;'))
  assert.ok(cleaned.endsWith('CREATE TABLE t (id int);\n'))
})

test('data holding the same words is left alone', async () => {
  const data = 'SET transaction_timeout = 0;\nnot a dump header\n'
  assert.equal(await collect(withoutHeaderTimeouts(chunks(data))), data)

  const late = `${DUMP_HEADER}${'x'.repeat(5000)}\nSET transaction_timeout = 0;\n`
  assert.ok((await collect(withoutHeaderTimeouts(chunks(late)))).endsWith('SET transaction_timeout = 0;\n'))
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
    // Before the file, inside the same transaction, with the header's own line gone.
    const first = call.args.indexOf('-c')
    assert.match(call.args[first + 1], /^SET lock_timeout = '\d+s'$/)
    // Then the schema is cleared, then the file, all in that one transaction.
    assert.equal(call.args[first + 2], '-c')
    assert.equal(call.args[first + 3], CLEAR_SCHEMA_SQL)
    assert.equal(call.args[first + 4], '-f')
    assert.ok(!call.sql.includes('lock_timeout'))
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
    writeFileSync(gz, gzipSync(`${DUMP_HEADER}SELECT 2;\n${DUMP_FOOTER}`))
    await restoreInTransaction(gz, DB, {
      scratchRoot: s.scratchRoot,
      commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
    })
    const call = JSON.parse(readFileSync(s.log, 'utf8'))
    assert.ok(call.args.includes('--single-transaction'))
    assert.ok(call.sql.includes('SELECT 2;\n'))
  } finally {
    s.cleanup()
  }
})

test('clearing the schema leaves extensions and everything their members hold', () => {
  for (const catalog of ['pg_class', 'pg_proc', 'pg_type']) {
    assert.match(CLEAR_SCHEMA_SQL, new RegExp(`classid = '${catalog}'::regclass[^)]*deptype = 'e'`))
  }
  assert.ok(!/DROP EXTENSION|DROP SCHEMA/.test(CLEAR_SCHEMA_SQL))
})

test('a file that is not a whole database is refused, because clearing would lose the rest', async () => {
  const s = sandbox()
  try {
    // What `pg_dump -t movies -t series` makes.
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `--\n-- PostgreSQL database dump\n--\n\nSET client_encoding = 'UTF8';\nCREATE TABLE public.movies (id integer);\n${DUMP_FOOTER}`)
    await assert.rejects(
      restoreInTransaction(backup, DB, {
        scratchRoot: s.scratchRoot,
        commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
      }),
      /does not hold a whole database/
    )
    assert.equal(existsSync(s.log), false, 'psql ran')
  } finally {
    s.cleanup()
  }
})

test('lines only an extension owner may run leave the file; creating one stays', async () => {
  const tables = new Set<string>()
  const data = 'COPY public.users (id) FROM stdin;\nDROP EXTENSION IF EXISTS vector;\n\\.\n'
  const body = `${DUMP_HEADER}${data}`
  // Split mid-line, so a line can arrive in two chunks.
  const out = await collect(withoutExtensionOwnership(chunks(body.slice(0, 120), body.slice(120, 123), body.slice(123)), tables))
  assert.ok(!out.includes("COMMENT ON EXTENSION"))
  assert.ok(out.includes('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;'))
  assert.equal(out.split('DROP EXTENSION IF EXISTS vector;').length, 2, 'only the row of data keeps the words')
  assert.ok(out.endsWith(data), 'data passes untouched')
  assert.deepEqual([...tables], ['aperture_migrations', 'users'])
})

test('work after the commit runs while the API still stands aside, and its failure says so', async () => {
  const s = sandbox()
  try {
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `${DUMP_HEADER}SELECT 6;\n${DUMP_FOOTER}`)
    const commands = { pgRestore: s.pgRestoreScript(''), psql: s.psql }

    let during: boolean | null = null
    await restoreInTransaction(backup, DB, {
      scratchRoot: s.scratchRoot,
      commands,
      afterCommit: async () => {
        during = isDatabaseRestoring()
      },
    })
    assert.equal(during, true)
    assert.equal(isDatabaseRestoring(), false)

    await assert.rejects(
      restoreInTransaction(backup, DB, {
        scratchRoot: s.scratchRoot,
        commands,
        afterCommit: async () => {
          throw new Error('migration 0215 failed')
        },
      }),
      /was restored, but bringing it up to date failed: migration 0215 failed/
    )
    assert.equal(isDatabaseRestoring(), false)
  } finally {
    s.cleanup()
  }
})

test('a plain SQL file that was cut off never reaches psql', async () => {
  const s = sandbox()
  try {
    const commands = { pgRestore: s.pgRestoreScript(''), psql: s.psql }
    const cutOff = `${DUMP_HEADER}DROP TABLE movies;\nCREATE TABLE mov`

    for (const [name, bytes] of [
      ['a.sql', Buffer.from(cutOff)],
      // A clean gzip of an incomplete dump: pg_dump died and gzip still finished.
      ['b.sql.gz', gzipSync(cutOff)],
    ] as const) {
      const backup = join(s.scratchRoot, name)
      writeFileSync(backup, bytes)
      await assert.rejects(
        restoreInTransaction(backup, DB, { scratchRoot: s.scratchRoot, commands }),
        /closing line/,
        name
      )
    }
    assert.equal(existsSync(s.log), false, 'psql ran')
    assert.equal(isDatabaseRestoring(), false)
  } finally {
    s.cleanup()
  }
})

test('a closing line followed by what newer pg_dump writes after it still counts', async () => {
  const s = sandbox()
  try {
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `${DUMP_HEADER}SELECT 5;\n${DUMP_FOOTER}\\unrestrict abc\n`)
    await restoreInTransaction(backup, DB, {
      scratchRoot: s.scratchRoot,
      commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
    })
    assert.ok(JSON.parse(readFileSync(s.log, 'utf8')).sql.includes('SELECT 5;'))
  } finally {
    s.cleanup()
  }
})

test('a failed psql is reported, and nothing is left behind or locked', async () => {
  const s = sandbox()
  try {
    process.env.RESTORE_TEST_PSQL_FAILS = '1'
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `${DUMP_HEADER}SELECT 3;\n${DUMP_FOOTER}`)
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

test('a restore that could not get its locks says what to do about it', async () => {
  const s = sandbox()
  try {
    process.env.RESTORE_TEST_PSQL_FAILS = '1'
    process.env.RESTORE_TEST_PSQL_STDERR = 'psql:restore.sql:40: ERROR:  canceling statement due to lock timeout'
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `${DUMP_HEADER}SELECT 3;\n${DUMP_FOOTER}`)
    await assert.rejects(
      restoreInTransaction(backup, DB, {
        scratchRoot: s.scratchRoot,
        commands: { pgRestore: s.pgRestoreScript(''), psql: s.psql },
      }),
      /changed nothing.*Try again.*lock timeout/
    )
    assert.equal(isDatabaseRestoring(), false)
  } finally {
    s.cleanup()
  }
})

test('any other failure keeps its own words', () => {
  assert.equal(describeRestoreFailure('psql exited with 3: ERROR: boom'), 'psql exited with 3: ERROR: boom')
})

test('only one restore can hold the claim, and it can be claimed again once released', () => {
  assert.equal(isRestoreInProgress(), false)
  assert.equal(claimRestore(), true)
  assert.equal(isRestoreInProgress(), true)
  assert.equal(claimRestore(), false)
  releaseRestore()
  assert.equal(isRestoreInProgress(), false)
  assert.equal(claimRestore(), true)
  releaseRestore()
})

test('the database reads as restoring only while psql runs', async () => {
  const s = sandbox()
  try {
    const backup = join(s.scratchRoot, 'a.sql')
    writeFileSync(backup, `${DUMP_HEADER}SELECT 4;\n${DUMP_FOOTER}`)
    const commands = { pgRestore: s.pgRestoreScript(''), psql: s.psql }

    let duringApply: boolean | null = null
    const first = restoreInTransaction(backup, DB, {
      scratchRoot: s.scratchRoot,
      commands,
      onApplying: () => { queueMicrotask(() => { duringApply = isDatabaseRestoring() }) },
    })
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
    assert.equal(readFileSync(`${file}.partial`, 'utf8'), 'someone else is writing', 'the other writer lost its file')
  } finally {
    s.cleanup()
  }
})

test('a whole upload is published under its real name', async () => {
  const s = sandbox()
  try {
    const file = join(s.scratchRoot, 'a.sql')
    await writeBackupUpload(Readable.from([Buffer.from('all of it')]), file)
    assert.equal(readFileSync(file, 'utf8'), 'all of it')
    assert.deepEqual(readdirSync(s.scratchRoot), ['a.sql'])
  } finally {
    s.cleanup()
  }
})

test('an upload cut off at its limit is refused and leaves nothing', async () => {
  const s = sandbox()
  try {
    const stream = Object.assign(Readable.from([Buffer.from('part of it')]), { truncated: true })
    await assert.rejects(writeBackupUpload(stream, join(s.scratchRoot, 'a.sql')), BackupUploadTooLargeError)
    assert.deepEqual(readdirSync(s.scratchRoot), [])
  } finally {
    s.cleanup()
  }
})

test('an upload whose connection dropped leaves nothing', async () => {
  const s = sandbox()
  try {
    const dropped = new Readable({
      read() {
        this.push(Buffer.from('part of it'))
        this.destroy(new Error('Unexpected end of form'))
      },
    })
    await assert.rejects(writeBackupUpload(dropped, join(s.scratchRoot, 'a.sql')), /Unexpected end of form/)
    assert.deepEqual(readdirSync(s.scratchRoot), [])
  } finally {
    s.cleanup()
  }
})

test('a partial left by a dead process is swept, one being written is not', async () => {
  const s = sandbox()
  try {
    const abandoned = join(s.scratchRoot, 'aperture_backup_old.dump.partial')
    const kept = join(s.scratchRoot, 'aperture_backup_kept.dump')
    const recent = join(s.scratchRoot, 'aperture_backup_other_instance.dump.partial')
    writeFileSync(abandoned, 'PGDMP half')
    writeFileSync(kept, 'PGDMP')
    writeFileSync(recent, 'PGDMP')
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    utimesSync(abandoned, twoDaysAgo, twoDaysAgo)

    const file = join(s.scratchRoot, 'aperture_backup_new.dump')
    const running = writeArchive(
      fakeDump(`process.stdout.write('PGDMP'); setTimeout(() => {}, 300)`),
      file
    )
    while (!existsSync(`${file}.partial`)) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 50))

    await removeAbandonedPartials(s.scratchRoot)
    assert.equal(existsSync(abandoned), false)
    assert.equal(existsSync(kept), true)
    assert.equal(existsSync(recent), true, 'it may be another instance writing')
    assert.equal(existsSync(`${file}.partial`), true, 'the running dump lost its file')

    await running
    assert.equal(existsSync(file), true)
    assert.deepEqual(readdirSync(s.scratchRoot).sort(), [
      'aperture_backup_kept.dump',
      'aperture_backup_new.dump',
      'aperture_backup_other_instance.dump.partial',
    ])
  } finally {
    s.cleanup()
  }
})
