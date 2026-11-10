/**
 * Bitwarden Secrets Manager: reading the operator's project and keeping what
 * it holds, in memory only.
 *
 * The project is read whole by the `bws` CLI (`bws secret list <project>`),
 * one process per read, at most once per `SECRETS_TTL_MS`. Bitwarden rate-limits
 * by address, and a job reads its key hundreds of times: per-lookup calls would
 * be both slow and refused.
 *
 * Nothing here writes a secret anywhere: not to the database, a file or a log.
 * The CLI may keep its own session state under the user's home directory; when
 * it cannot (the image's user has none), it says so on stderr and carries on,
 * which is why only stdout is parsed.
 *
 * The rules (reference format, what may be linked, when to ask again, what a
 * failure may say) are in `rules.ts`, pure and pinned.
 */
import { execFile } from 'node:child_process'
import { createChildLogger } from '../lib/logger.js'
import {
  bwsChildEnvironment,
  describeSecretsFailure,
  linkableNames,
  lookupSecret,
  parseSecretList,
  parseSecretRef,
  readSecretsBootstrap,
  shouldFetchSecrets,
  type BootstrapProblem,
  type SecretLookup,
  type SecretSnapshot,
  type SecretsBootstrap,
  type SecretsFailure,
} from './rules.js'

const logger = createChildLogger('secrets')

/** One read of the project. The CLI makes two HTTPS requests; this is generous. */
const BWS_TIMEOUT_MS = 20_000
const BWS_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Runs the CLI and answers its stdout; rejects with the child-process error. */
export type BwsRunner = (bootstrap: SecretsBootstrap) => Promise<string>

const runBws: BwsRunner = (bootstrap) =>
  new Promise((resolve, reject) => {
    execFile(
      bootstrap.bwsPath,
      ['secret', 'list', bootstrap.projectId, '--output', 'json'],
      { env: bwsChildEnvironment(bootstrap, process.env), timeout: BWS_TIMEOUT_MS, maxBuffer: BWS_MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }))
          return
        }
        resolve(stdout)
      }
    )
  })

export interface SecretStoreDeps {
  run: BwsRunner
  now: () => number
  env: () => Record<string, string | undefined>
}

export interface SecretsStatus {
  /** Whether an access token and a project are set. */
  configured: boolean
  /** Why not, when something was set but cannot be used. Null when simply off. */
  problem: BootstrapProblem | null
  projectId: string | null
  /** Null = Bitwarden's own cloud. */
  serverUrl: string | null
  /** Whether the project has been read at least once since the process started. */
  connected: boolean
  secretCount: number
  /** Names two secrets share; a link to one of these cannot be honoured. */
  ambiguousNames: string[]
  fetchedAt: string | null
  /** The latest attempt failed, and what is served is from the read before it. */
  stale: boolean
  lastFailure: (SecretsFailure & { at: string }) | null
}

/**
 * The store, built over injected dependencies so its behaviour (one read at a
 * time, last good values kept through a failure, the retry wait) is tested
 * without a Bitwarden account or the CLI.
 */
export function createSecretStore(deps: SecretStoreDeps) {
  let snapshot: SecretSnapshot | null = null
  let fetchedAt: number | null = null
  let failure: (SecretsFailure & { at: number }) | null = null
  let inflight: Promise<void> | null = null
  /** The token and project the snapshot was read with. */
  let snapshotIdentity: string | null = null
  const warned = new Map<string, number>()

  function reading() {
    return readSecretsBootstrap(deps.env())
  }

  async function fetchOnce(bootstrap: SecretsBootstrap): Promise<void> {
    const identity = `${bootstrap.serverUrl ?? ''}|${bootstrap.projectId}|${bootstrap.accessToken}`
    try {
      const stdout = await deps.run(bootstrap)
      let parsed: SecretSnapshot
      try {
        parsed = parseSecretList(stdout)
      } catch (err) {
        failure = { kind: 'unreadable', detail: err instanceof Error ? err.message : null, at: deps.now() }
        logger.warn({ kind: failure.kind, detail: failure.detail }, 'Bitwarden secrets could not be read')
        return
      }
      snapshot = parsed
      snapshotIdentity = identity
      fetchedAt = deps.now()
      failure = null
      logger.info(
        { secrets: parsed.values.size, ambiguous: parsed.ambiguous.size },
        'Bitwarden secrets read'
      )
    } catch (err) {
      const described = describeSecretsFailure(err as Record<string, unknown>, bootstrap.accessToken)
      failure = { ...described, at: deps.now() }
      // Values read under another token or project are not this one's to serve.
      if (snapshotIdentity !== null && snapshotIdentity !== identity) {
        snapshot = null
        fetchedAt = null
        snapshotIdentity = null
      }
      logger.warn({ kind: described.kind, detail: described.detail }, 'Bitwarden secrets could not be read')
    }
  }

  /** Reads the project if it is due (or `force`), sharing one read among callers. */
  async function ensure(force = false): Promise<void> {
    const state = reading()
    if (!state.configured) {
      snapshot = null
      fetchedAt = null
      snapshotIdentity = null
      return
    }
    if (inflight) return inflight
    const due = force || shouldFetchSecrets({ fetchedAt, failedAt: failure?.at ?? null }, deps.now())
    if (!due) return
    inflight = fetchOnce(state.bootstrap).finally(() => {
      inflight = null
    })
    return inflight
  }

  /**
   * One secret, from what is in memory.
   *
   * Only a store that has never read the project waits for the read. Once
   * there are values, a read that has come due runs behind the answer: this is
   * called on request paths (every poster asks for the media server's key),
   * and a Bitwarden that is slow or not answering must not hold those up for
   * the length of the CLI's time limit each time the retry comes round.
   */
  async function lookup(name: string): Promise<SecretLookup> {
    if (snapshot === null) await ensure()
    else void ensure()
    return lookupSecret(snapshot, name)
  }

  /**
   * A stored setting as the value to use: the value itself, or the secret a
   * reference names. Null when the reference cannot be honoured, with one
   * warning per name per minute saying why. Never throws.
   */
  async function resolve(stored: string | null): Promise<string | null> {
    const name = parseSecretRef(stored)
    if (name === null) return stored
    const found = await lookup(name)
    if (found.status === 'ok') return found.value
    const last = warned.get(name)
    const now = deps.now()
    if (last === undefined || now - last >= 60_000) {
      warned.set(name, now)
      // `linkedName`, not `secret`: the logger redacts fields called that, and
      // the name is the one thing that makes this line useful.
      logger.warn({ linkedName: name, reason: found.status }, 'A credential linked to Bitwarden is unavailable')
    }
    return null
  }

  function status(): SecretsStatus {
    const state = reading()
    return {
      configured: state.configured,
      problem: state.configured || state.problem === 'off' ? null : state.problem,
      projectId: state.configured ? state.bootstrap.projectId : null,
      serverUrl: state.configured ? state.bootstrap.serverUrl : null,
      connected: snapshot !== null,
      secretCount: snapshot ? snapshot.values.size + snapshot.ambiguous.size : 0,
      ambiguousNames: snapshot ? [...snapshot.ambiguous].sort() : [],
      fetchedAt: fetchedAt != null ? new Date(fetchedAt).toISOString() : null,
      stale: snapshot !== null && failure !== null,
      lastFailure: failure
        ? { kind: failure.kind, detail: failure.detail, at: new Date(failure.at).toISOString() }
        : null,
    }
  }

  /** The names that can be linked (`linkableNames`). */
  function names(): string[] {
    return linkableNames(snapshot)
  }

  return { ensure, lookup, resolve, status, names }
}

const store = createSecretStore({ run: runBws, now: () => Date.now(), env: () => process.env })

/** A stored credential setting as the value to use. See `createSecretStore().resolve`. */
export const resolveStoredSecret = store.resolve
/** Reads the project now (`force`) or if it is due. Never throws. */
export const refreshBitwardenSecrets = (force = false) => store.ensure(force)
export const getBitwardenSecretsStatus = store.status
export const getBitwardenSecretNames = store.names
export const lookupBitwardenSecret = store.lookup
