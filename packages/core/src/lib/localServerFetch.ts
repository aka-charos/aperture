/**
 * The two pieces every probe of a local inference server needs: the headers it
 * sends, and the sentence a failed connection becomes. Shared by the LM Studio
 * and Unsloth Studio readers, which are otherwise different APIs.
 */

/**
 * A local server may be told to require a bearer token (LM Studio optionally,
 * Unsloth outside its keyless addresses). Sending one it did not ask for is
 * harmless, so the key rides along whenever the operator entered it — the
 * alternative is a probe that 401s on a locked-down server while the inference
 * calls, which do send it, work.
 */
export function localServerAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/** What the operator should check, in this server's own terms. */
export interface FetchFailureHints {
  /** After "Connection refused (CODE).": nothing listens at that address. */
  refused: string
  /** After "Timed out reaching the server (CODE).": nothing answered. */
  timedOut: string
}

/**
 * Why a request to the server did not arrive.
 *
 * A connection failure carries its reason in `error.cause.code`, and for these
 * integrations that code IS the diagnosis: `ENOTFOUND host.docker.internal` says
 * the container cannot resolve the host, `ECONNREFUSED` says nothing is
 * listening on that port, `ETIMEDOUT` says a firewall ate it. Collapsing all
 * three into "could not connect" throws away the only sentence that tells an
 * operator what to change — and Aperture in Docker reaching a server on the
 * host is the normal deployment, where every one has a different fix.
 *
 * A probe's own `AbortSignal.timeout` firing first carries no code, only the
 * error's name, and means the same thing as a connect timeout.
 */
export function describeLocalFetchFailure(err: unknown, hints: FetchFailureHints): string {
  const code = (err as { cause?: { code?: string } })?.cause?.code
  const message = err instanceof Error ? err.message : String(err)

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Host not found (${code}). From a container, the host machine is usually host.docker.internal.`
    case 'ECONNREFUSED':
      return `Connection refused (${code}). ${hints.refused}`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `Timed out reaching the server (${code}). ${hints.timedOut}`
    case 'ECONNRESET':
      return `Connection reset (${code}).`
    default:
      if (err instanceof Error && err.name === 'TimeoutError') {
        return `Timed out reaching the server. ${hints.timedOut}`
      }
      return code ? `${message} (${code})` : message
  }
}
