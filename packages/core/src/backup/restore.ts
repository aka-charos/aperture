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
 * `--single-transaction` would then COMMIT the truncated restore.
 *
 * One transaction has a cost the old path did not. `DROP TABLE` holds ACCESS
 * EXCLUSIVE until commit, so every read of a table the dump replaces, `sessions`
 * included, WAITS until the restore finishes rather than failing. The auth hook
 * reads `sessions` on every request, so without `isDatabaseRestoring` a page left
 * open would fill the connection pool with waiting lookups. See F-182.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { createChildLogger } from '../lib/logger.js'

const logger = createChildLogger('database-restore')

/** Inside the backup folder, which has room for dumps; the container's own disk may not. */
const SCRATCH_PREFIX = '.restore-'

/** Enough to hold pg_dump's opening comment and SET lines. */
const HEADER_BYTES = 4096

const STDERR_KEEP_CHARS = 16000

let restoreRunning = false
let applying = false

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
}

/**
 * pg_dump 17 writes `SET transaction_timeout = 0` whatever server it read, and a
 * PostgreSQL 16 server refuses the parameter, which ON_ERROR_STOP makes fatal.
 * The line only asks for the default, so it is removed for every server rather
 * than asking which one this is. Only pg_dump's own header is touched: a row of
 * data holding the same words is left alone.
 */
export async function* withoutTransactionTimeout(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let header: Buffer[] | null = []
  let headerBytes = 0

  const clean = (bytes: Buffer): Buffer => {
    const boundary = bytes.indexOf('SET client_encoding =')
    if (boundary < 0) return bytes
    const preamble = bytes.subarray(0, boundary).toString('utf8')
    if (!preamble.startsWith('--') || !preamble.includes('-- PostgreSQL database dump')) return bytes
    return Buffer.concat([
      Buffer.from(preamble.replace(/^SET transaction_timeout = 0;\r?\n/m, '')),
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

/** Write the backup out as SQL, or throw if any of it could not be read. */
async function expandToSql(filePath: string, sqlPath: string, commands: RestoreCommands): Promise<void> {
  const output = createWriteStream(sqlPath, { mode: 0o600 })
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
          pipeline(converter.stdout!, withoutTransactionTimeout, output),
          converted,
        ])
      } finally {
        if (converter.exitCode === null && converter.signalCode === null) converter.kill()
        await converted.catch(() => undefined)
      }
    } else if (filePath.endsWith('.gz')) {
      await pipeline(createReadStream(filePath), createGunzip(), withoutTransactionTimeout, output)
    } else {
      await pipeline(createReadStream(filePath), withoutTransactionTimeout, output)
    }
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

export async function restoreInTransaction(
  filePath: string,
  db: RestoreConnection,
  { scratchRoot, commands = DEFAULT_COMMANDS, onApplying }: RestoreOptions
): Promise<void> {
  if (restoreRunning) throw new Error('Another restore is already running')
  restoreRunning = true

  let scratch: string | null = null
  try {
    await removeOrphanedScratch(scratchRoot)
    scratch = await fs.mkdtemp(join(scratchRoot, SCRATCH_PREFIX))
    const sqlPath = join(scratch, 'restore.sql')

    await expandToSql(filePath, sqlPath, commands)

    onApplying?.()
    applying = true
    const restore = launch(
      commands.psql,
      ['-X', '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
        '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', sqlPath],
      { env: { ...process.env, PGPASSWORD: db.password }, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    await exited(restore, 'psql')
  } finally {
    applying = false
    restoreRunning = false
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
  const partialPath = `${filePath}.partial`
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
  // 'wx': two backups in one second must fail rather than overwrite each other.
  const written = pipeline(dump.stdout!, createWriteStream(partialPath, { flags: 'wx' }))

  try {
    await Promise.all([dumped, written])
    if (isCancelled()) throw new BackupCancelledError()
    await assertArchiveHeader(partialPath)
    await fs.rename(partialPath, filePath)
  } catch (err) {
    if (dump.exitCode === null && dump.signalCode === null) dump.kill()
    await Promise.allSettled([dumped, written])
    await fs.unlink(partialPath).catch(() => undefined)
    throw err
  }
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
