/**
 * Applying a backup to the database: all of it, or none of it.
 *
 * `pg_restore --clean` straight at the database drops each table and rebuilds it
 * as it goes, so a failure part-way left a half-replaced database, and the only
 * way back was the safety backup. Here the archive is first expanded to a SQL
 * file, which proves it reads to the end, and only then applied by `psql` in one
 * transaction with ON_ERROR_STOP. Anything that fails leaves the database as it
 * was.
 *
 * Expanding to a file rather than piping is load-bearing. Through a pipe, an
 * archive that fails half-way reads to psql as a clean end of input, and
 * `--single-transaction` would then COMMIT the truncated restore. A plain SQL file
 * has no format to fail on, so it must also end with pg_dump's own closing line.
 *
 * One transaction has a cost the old path did not. `DROP TABLE` holds ACCESS
 * EXCLUSIVE until commit, so every read of a table the dump replaces, `sessions`
 * included, WAITS until the restore finishes rather than failing. The auth hook
 * reads `sessions` on every request, so without `isDatabaseRestoring` a page left
 * open would fill the connection pool with waiting lookups. See F-182.
 *
 * The transaction also has to get those locks, and a running job can hold one for
 * a long time. Nothing can cancel a restore and the API answers 503 until it ends,
 * so a wait is bounded: past `LOCK_WAIT_SECONDS` on one statement the restore fails
 * and rolls back, and can be run again.
 *
 * The backup is usually older than this schema, since restoring old data is what a
 * restore is for. Tables added since then reference tables the dump drops, which
 * refuses, so the transaction first clears what the dump will replace (`CLEAR_SCHEMA_SQL`)
 * and migrations bring the result up to date. Clearing is why a file that is not a
 * whole database is refused: it would commit with everything else gone. Extensions
 * stay: the role may not own them, so the dump's lines dropping them are removed.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('database-restore')

/** Inside the backup folder, which has room for dumps; the container's own disk may not. */
const SCRATCH_PREFIX = '.restore-'

const PARTIAL_SUFFIX = '.partial'

/** Enough to hold pg_dump's opening comment and SET lines. */
const HEADER_BYTES = 4096

const STDERR_KEEP_CHARS = 16000

/** Chosen, not measured: long enough for an ordinary query, short of a long outage. */
const LOCK_WAIT_SECONDS = 60

let restoreClaimed = false
let applying = false

/** Files being written right now, so a sweep cannot take one from under its writer. */
const partialsInUse = new Set<string>()

/**
 * Taken before the file exists, so anything a sweep can list is already covered.
 * The returned call gives it back, unless this name was someone else's to begin with.
 */
function reservePartial(partialPath: string): () => void {
  const ours = !partialsInUse.has(partialPath)
  partialsInUse.add(partialPath)
  return () => {
    if (ours) partialsInUse.delete(partialPath)
  }
}

/** A .partial younger than this may be another instance's, on a folder they share. */
const PARTIAL_ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Empties `public` of everything but extensions, inside the restore's transaction.
 * Statements are built in one query first, because a CASCADE drops other entries on
 * the list, which is also why each says IF EXISTS.
 */
export const CLEAR_SCHEMA_SQL = `DO $aperture_clear$
DECLARE
  statements text;
BEGIN
  SELECT string_agg(statement, '; ') INTO statements FROM (
    SELECT format(
             'DROP %s IF EXISTS public.%I CASCADE',
             CASE c.relkind
               WHEN 'v' THEN 'VIEW'
               WHEN 'm' THEN 'MATERIALIZED VIEW'
               WHEN 'S' THEN 'SEQUENCE'
               WHEN 'f' THEN 'FOREIGN TABLE'
               ELSE 'TABLE'
             END,
             c.relname
           ) AS statement
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
       )
    UNION ALL
    SELECT format('DROP ROUTINE IF EXISTS %s CASCADE', p.oid::regprocedure)
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
    UNION ALL
    SELECT format('DROP TYPE IF EXISTS public.%I CASCADE', t.typname)
      FROM pg_type t
      LEFT JOIN pg_class r ON r.oid = t.typrelid
     WHERE t.typnamespace = 'public'::regnamespace
       AND t.typtype IN ('c', 'd', 'e', 'r')
       AND (t.typrelid = 0 OR r.relkind = 'c')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
       )
  ) AS drops;
  IF statements IS NOT NULL THEN
    EXECUTE statements;
  END IF;
END
$aperture_clear$;`

/** Only the owner may run these, and an extension left in place needs neither. */
const EXTENSION_OWNER_ONLY = /^(?:DROP EXTENSION (?:IF EXISTS )?[^;]+;|COMMENT ON EXTENSION .*;)\s*$/

/** Tables a whole database of this app must define, or clearing it loses the rest. */
const REQUIRED_TABLES = ['aperture_migrations', 'users']

const TABLE_DEFINITION = /^CREATE TABLE (?:public\.)?"?([A-Za-z0-9_]+)"?/

/** What pg_dump writes last, so a SQL file holding it was not cut off. */
const DUMP_END = /^-- PostgreSQL database (?:cluster )?dump complete\s*$/m

/** Enough for that line and the few pg_dump may write after it. */
const DUMP_END_SEARCH_BYTES = 4096

/**
 * Claim the one restore allowed at a time. Synchronous, so a route that asks
 * `isRestoreInProgress` and then starts one with no await between cannot race.
 */
export function claimRestore(): boolean {
  if (restoreClaimed) return false
  restoreClaimed = true
  return true
}

export function releaseRestore(): void {
  restoreClaimed = false
}

/** True from the moment a restore starts, safety backup included. */
export function isRestoreInProgress(): boolean {
  return restoreClaimed
}

/**
 * True while the restore's transaction is open. The database is then locked
 * table by table, so anything that can answer without it should not ask.
 */
export function isDatabaseRestoring(): boolean {
  return applying
}

export interface RestoreConnection {
  host: string
  port: string
  user: string
  database: string
  password: string
}

/** The programs to run, as argv prefixes, so a test can stand in for them. */
export interface RestoreCommands {
  pgRestore: string[]
  psql: string[]
}

const DEFAULT_COMMANDS: RestoreCommands = { pgRestore: ['pg_restore'], psql: ['psql'] }

export interface RestoreOptions {
  scratchRoot: string
  commands?: RestoreCommands
  /** Told once when the archive has been read and the transaction is about to open. */
  onApplying?: () => void
  /** Once it has committed, while the API is still answering 503. */
  afterCommit?: () => Promise<void>
}

/**
 * Two lines leave pg_dump's header. `SET transaction_timeout = 0` is written by
 * pg_dump 17 whatever server it read, and a PostgreSQL 16 server refuses the
 * parameter, which ON_ERROR_STOP makes fatal; it only asks for the default, so it
 * goes for every server rather than asking which one this is. `SET lock_timeout = 0`
 * would switch off the bound on waiting for a lock that psql is given. Only the
 * header is touched: a row of data holding the same words is left alone.
 */
export async function* withoutHeaderTimeouts(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let header: Buffer[] | null = []
  let headerBytes = 0

  const clean = (bytes: Buffer): Buffer => {
    const boundary = bytes.indexOf('SET client_encoding =')
    if (boundary < 0) return bytes
    const preamble = bytes.subarray(0, boundary).toString('utf8')
    if (!preamble.startsWith('--') || !preamble.includes('-- PostgreSQL database dump')) return bytes
    return Buffer.concat([
      Buffer.from(preamble.replace(/^SET (?:transaction_timeout|lock_timeout) = 0;\r?\n/gm, '')),
      bytes.subarray(boundary),
    ])
  }

  for await (const chunk of source) {
    if (!header) {
      yield chunk
      continue
    }
    header.push(chunk)
    headerBytes += chunk.length
    if (headerBytes >= HEADER_BYTES) {
      yield clean(Buffer.concat(header))
      header = null
    }
  }
  if (header) yield clean(Buffer.concat(header))
}

/**
 * Reads the statements before the first row of data: removes the extension lines an
 * owner alone may run, and notes which tables are defined. Past the first COPY the
 * bytes are data, so they pass untouched, and nothing is scanned.
 */
export async function* withoutExtensionOwnership(
  source: AsyncIterable<Buffer>,
  tablesDefined: Set<string>
): AsyncGenerator<Buffer> {
  let scanning = true
  let pending: Buffer = Buffer.alloc(0)

  const keep = (line: Buffer): boolean => {
    const text = line.toString('utf8')
    const table = text.match(TABLE_DEFINITION)
    if (table) tablesDefined.add(table[1])
    return !EXTENSION_OWNER_ONLY.test(text)
  }

  for await (const chunk of source) {
    if (!scanning) {
      yield chunk
      continue
    }
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk

    const kept: Buffer[] = []
    let start = 0
    for (;;) {
      const end = pending.indexOf(10, start)
      if (end < 0) break
      const line = pending.subarray(start, end + 1)
      if (line.subarray(0, 5).toString('latin1') === 'COPY ') {
        scanning = false
        break
      }
      if (keep(line)) kept.push(line)
      start = end + 1
    }
    if (!scanning) {
      kept.push(pending.subarray(start))
      pending = Buffer.alloc(0)
    } else {
      pending = pending.subarray(start)
    }
    if (kept.length > 0) yield Buffer.concat(kept)
  }
  if (pending.length > 0 && keep(pending)) yield pending
}

function launch(argv: string[], args: string[], options: Parameters<typeof spawn>[2]): ChildProcess {
  return spawn(argv[0], [...argv.slice(1), ...args], options)
}

/** Resolves when the program exits 0; otherwise rejects with what it said. */
function exited(child: ChildProcess, name: string): Promise<void> {
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP_CHARS)
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${name} exited with ${signal ?? code}: ${stderr.trim()}`))
    })
  })
}

/**
 * Write the backup out as SQL, or throw if any of it could not be read. Answers with
 * the tables it defines.
 */
async function expandToSql(filePath: string, sqlPath: string, commands: RestoreCommands): Promise<Set<string>> {
  const output = createWriteStream(sqlPath, { mode: 0o600 })
  const tablesDefined = new Set<string>()
  const scanned = (source: AsyncIterable<Buffer>) => withoutExtensionOwnership(source, tablesDefined)
  try {
    if (filePath.endsWith('.dump')) {
      const converter = launch(
        commands.pgRestore,
        ['--clean', '--if-exists', '--no-owner', '--no-acl', '--file=-', filePath],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const converted = exited(converter, 'pg_restore')
      try {
        await Promise.all([
          pipeline(converter.stdout!, withoutHeaderTimeouts, scanned, output),
          converted,
        ])
      } finally {
        if (converter.exitCode === null && converter.signalCode === null) converter.kill()
        await converted.catch(() => undefined)
      }
    } else if (filePath.endsWith('.gz')) {
      await pipeline(createReadStream(filePath), createGunzip(), withoutHeaderTimeouts, scanned, output)
    } else {
      await pipeline(createReadStream(filePath), withoutHeaderTimeouts, scanned, output)
    }
    return tablesDefined
  } finally {
    output.destroy()
  }
}

/**
 * Remove what a process that died mid-restore left behind. One restore runs at a
 * time, so anything here is an orphan, and it can be as large as the database.
 */
async function removeOrphanedScratch(scratchRoot: string): Promise<void> {
  const entries = await fs.readdir(scratchRoot).catch(() => [] as string[])
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue
    await fs.rm(join(scratchRoot, entry), { recursive: true, force: true }).catch((err) =>
      logger.warn({ err, entry }, 'Could not remove a left-over restore folder')
    )
  }
}

/**
 * Remove dumps a process that died mid-backup left behind. The list hides them and
 * retention never sees them, so nothing else would, and each can be as large as a
 * backup. Only old ones: a recent file may belong to another instance on this folder.
 */
export async function removeAbandonedPartials(backupRoot: string): Promise<void> {
  const entries = await fs.readdir(backupRoot).catch(() => [] as string[])
  for (const entry of entries) {
    const entryPath = join(backupRoot, entry)
    if (!entry.endsWith(PARTIAL_SUFFIX) || partialsInUse.has(entryPath)) continue
    try {
      const { mtimeMs } = await fs.stat(entryPath)
      if (Date.now() - mtimeMs < PARTIAL_ABANDONED_AFTER_MS) continue
      await fs.rm(entryPath, { force: true })
    } catch (err) {
      logger.warn({ err, entry }, 'Could not remove a left-over partial backup')
    }
  }
}

/**
 * A cut-off SQL file reads to psql like a short one, and committing it would leave
 * every table the file had not reached yet dropped. An archive proves itself by
 * reading to the end; SQL can only say it finished.
 */
async function assertSqlComplete(sqlPath: string): Promise<void> {
  const file = await fs.open(sqlPath, 'r')
  try {
    const { size } = await file.stat()
    const length = Math.min(size, DUMP_END_SEARCH_BYTES)
    const tail = Buffer.alloc(length)
    await file.read(tail, 0, length, size - length)
    if (!DUMP_END.test(tail.toString('utf8'))) {
      throw new Error(
        "This SQL file does not end with pg_dump's closing line, so it is incomplete or was not made by pg_dump. Nothing was changed."
      )
    }
  } finally {
    await file.close()
  }
}

/** Says what happened when the cause is one an admin can act on. */
export function describeRestoreFailure(message: string): string {
  if (!/lock timeout/i.test(message)) return message
  return (
    `The restore stopped and changed nothing: another task held a table for more than ${LOCK_WAIT_SECONDS} seconds. ` +
    `Try again once running jobs have finished. (${message})`
  )
}

/** Callers hold the claim (`claimRestore`). */
export async function restoreInTransaction(
  filePath: string,
  db: RestoreConnection,
  { scratchRoot, commands = DEFAULT_COMMANDS, onApplying, afterCommit }: RestoreOptions
): Promise<void> {
  let scratch: string | null = null
  try {
    await removeOrphanedScratch(scratchRoot)
    scratch = await fs.mkdtemp(join(scratchRoot, SCRATCH_PREFIX))
    const sqlPath = join(scratch, 'restore.sql')

    const tablesDefined = await expandToSql(filePath, sqlPath, commands)
    if (!filePath.endsWith('.dump')) await assertSqlComplete(sqlPath)
    if (!REQUIRED_TABLES.every((table) => tablesDefined.has(table))) {
      throw new Error(
        'This file does not hold a whole database for this app, so restoring it would remove everything it leaves out. Nothing was changed.'
      )
    }

    onApplying?.()
    applying = true
    const restore = launch(
      commands.psql,
      ['-X', '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
        '-v', 'ON_ERROR_STOP=1', '--single-transaction',
        '-c', `SET lock_timeout = '${LOCK_WAIT_SECONDS}s'`, '-c', CLEAR_SCHEMA_SQL, '-f', sqlPath],
      { env: { ...process.env, PGPASSWORD: db.password }, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    await exited(restore, 'psql').catch((err: Error) => {
      throw new Error(describeRestoreFailure(err.message), { cause: err })
    })

    await afterCommit?.().catch((err: unknown) => {
      const why = err instanceof Error ? err.message : String(err)
      throw new Error(
        `The backup was restored, but bringing it up to date failed: ${why}. Restart the app to try again.`,
        { cause: err }
      )
    })
  } finally {
    applying = false
    if (scratch) {
      await fs.rm(scratch, { recursive: true, force: true }).catch((err) =>
        logger.warn({ err, scratch }, 'Could not remove temporary restore data')
      )
    }
  }
}

/**
 * Stream a running pg_dump into `filePath`, publishing the file only if it worked.
 *
 * The file appears under its real name only after pg_dump has exited 0 and what
 * it wrote starts like an archive. Waiting for the write stream's `finish` alone
 * was not enough: it can fire before the exit code arrives, so a pg_dump that
 * failed part-way read as a successful backup, and a restore would then go ahead
 * on the strength of it.
 */
export async function writeArchive(
  dump: ChildProcess,
  filePath: string,
  isCancelled: () => boolean = () => false
): Promise<void> {
  const partialPath = `${filePath}${PARTIAL_SUFFIX}`
  let stderr = ''
  dump.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP_CHARS)
  })

  const dumped = new Promise<void>((resolve, reject) => {
    dump.on('error', reject)
    dump.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || isCancelled()) reject(new BackupCancelledError())
      else if (code !== 0) reject(new Error(`pg_dump exited with ${signal ?? code}: ${stderr.trim()}`))
      else resolve()
    })
  })
  let written: Promise<void> = Promise.resolve()

  await publishWhenWhole(
    filePath,
    async (output) => {
      written = pipeline(dump.stdout!, output)
      await Promise.all([dumped, written])
      if (isCancelled()) throw new BackupCancelledError()
      await assertArchiveHeader(partialPath)
    },
    async () => {
      if (dump.exitCode === null && dump.signalCode === null) dump.kill()
      await Promise.allSettled([dumped, written])
    }
  )
}

/**
 * The file appears under `filePath` only if `write` finishes, so nothing cut short
 * can ever be listed as a backup. 'wx': two writers of one name must fail rather
 * than overwrite each other, and the loser leaves the winner's file alone.
 */
async function publishWhenWhole(
  filePath: string,
  write: (output: WriteStream) => Promise<void>,
  onFailure?: () => Promise<void>
): Promise<void> {
  const partialPath = `${filePath}${PARTIAL_SUFFIX}`
  const release = reservePartial(partialPath)
  const output = createWriteStream(partialPath, { flags: 'wx' })
  let created = false
  output.once('open', () => {
    created = true
  })

  try {
    await write(output)
    await fs.rename(partialPath, filePath)
  } catch (err) {
    await onFailure?.()
    if (created) await fs.unlink(partialPath).catch(() => undefined)
    throw err
  } finally {
    release()
  }
}

export class BackupUploadTooLargeError extends Error {
  constructor() {
    super('Backup upload is over the limit')
    this.name = 'BackupUploadTooLargeError'
  }
}

/**
 * Save an uploaded file under `filePath` only once all of it has arrived. A multipart
 * stream over its limit ends without an error and sets `truncated`, and a dropped
 * connection can leave a file part-written, so neither may ever appear as a backup.
 */
export async function writeBackupUpload(
  source: Readable & { truncated?: boolean },
  filePath: string
): Promise<void> {
  await publishWhenWhole(filePath, async (output) => {
    await pipeline(source, output)
    if (source.truncated) throw new BackupUploadTooLargeError()
  })
}

export class BackupCancelledError extends Error {
  constructor() {
    super('Backup cancelled')
    this.name = 'BackupCancelledError'
  }
}

async function assertArchiveHeader(path: string): Promise<void> {
  const file = await fs.open(path, 'r')
  try {
    const header = Buffer.alloc(5)
    await file.read(header, 0, 5, 0)
    if (header.toString('ascii') !== 'PGDMP') throw new Error('pg_dump did not produce a valid archive')
  } finally {
    await file.close()
  }
}
