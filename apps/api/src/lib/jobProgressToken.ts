import { createHmac, timingSafeEqual } from 'crypto'
import { getEnv } from '../config/env.js'

/**
 * Short-lived, signed tokens that authorize reading ONE job's progress.
 *
 * A database restore replaces every table, `sessions` included, so the admin who
 * started it has no session to poll with while it runs and may have none after.
 * Verifying one of these touches nothing but memory, so it works when the
 * database cannot answer.
 *
 * Sent as a header, not in the URL, so it stays out of the access log. Scope is
 * deliberately tiny: the progress of the single job it was minted for.
 */

const TOKEN_VERSION = 'v1'

/** Long enough to cover a large restore; short enough to be uninteresting if leaked. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000

export const JOB_PROGRESS_TOKEN_HEADER = 'x-job-progress-token'

function sign(payload: string): string {
  // The secret the session cookie is signed with (server.ts), which lives in the
  // environment and so survives the restore.
  const secret = process.env.SESSION_SECRET || getEnv().SESSION_SECRET
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Format: v1.<jobId>.<expiresAtMs>.<signature> */
export function createJobProgressToken(jobId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const payload = `${TOKEN_VERSION}.${jobId}.${Date.now() + ttlMs}`
  return `${payload}.${sign(payload)}`
}

/** False for any malformed, mismatched, expired or badly signed token. */
export function verifyJobProgressToken(token: string | undefined, jobId: string): boolean {
  if (!token) return false

  const parts = token.split('.')
  if (parts.length !== 4) return false

  const [version, tokenJobId, expiresAtRaw, signature] = parts
  if (version !== TOKEN_VERSION || tokenJobId !== jobId) return false

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false

  const expected = Buffer.from(sign(`${version}.${tokenJobId}.${expiresAtRaw}`))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
