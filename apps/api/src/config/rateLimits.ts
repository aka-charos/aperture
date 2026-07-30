/**
 * Rate-limit policy for the unauthenticated auth surface.
 *
 * Kept out of the route files so the policy is one reviewable object per
 * endpoint, and so tests can assert against the exact config the server runs
 * rather than a copy that can drift away from it.
 */

/**
 * Build the value @fastify/rate-limit should throw when a limit trips.
 *
 * It does `throw params.errorResponseBuilder(...)`, and Fastify only honours a
 * status code from a thrown *Error* carrying `statusCode`. Returning a plain
 * object — the obvious reading of "response builder" — produces a 500 instead
 * of a 429: the request is still blocked, but it reads as a server fault to the
 * client, to logs and to any monitoring watching 5xx rates.
 */
function rateLimitError(
  message: string,
  context: { statusCode: number; after: string }
): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = context.statusCode
  return err
}

/**
 * POST /api/auth/login
 *
 * Keyed on IP ALONE, deliberately. Folding the submitted username into the key
 * widens the keyspace, so an attacker rotating usernames gets a fresh bucket on
 * every request and the limit never fires — which is exactly the shape of a
 * password spray, and would also let them insert a login_attempts row per
 * request. Per-IP caps total attempts from a source no matter what is in the
 * body; the per-account axis is covered by the DB lockout in
 * lib/loginAttempts.ts, which unlike an HTTP limit also holds across many IPs.
 */
export const loginRateLimit = {
  max: 20,
  timeWindow: '5 minutes',
  keyGenerator: (request: { ip: string }) => `login:${request.ip}`,
  errorResponseBuilder: (_request: unknown, context: { statusCode: number; after: string }) =>
    rateLimitError('Too many login attempts. Please wait and try again.', context),
}

/**
 * GET /api/auth/login-options
 *
 * Unauthenticated and backed by an uncached system_settings read, so it is a
 * free DB query for anyone who can reach the login page.
 */
export const loginOptionsRateLimit = {
  max: 60,
  timeWindow: '1 minute',
}

/**
 * GET /api/auth/check
 *
 * Reachable unauthenticated and does a session lookup per call. Generous
 * because the SPA calls it on every load and every open tab; it inherits the
 * plugin keyGenerator, so signed-in users get their own bucket rather than
 * sharing one behind a NAT.
 */
export const authCheckRateLimit = {
  max: 120,
  timeWindow: '1 minute',
}
