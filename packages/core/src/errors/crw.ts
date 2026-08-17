/**
 * fastCRW error codes.
 *
 * CRW is a SELF-HOSTED retrieval service (search + scrape + crawl), which makes
 * its failure profile different from every other integration in this directory:
 * the common fault is not an expired key or an exhausted plan, it is that the
 * container is down, on a different network, or was started without its SearXNG
 * sidecar. So the messages here point at compose and networking rather than at a
 * billing page — there is nobody to upgrade with.
 *
 * The `search_disabled` case is worth naming on its own: running the bare
 * single-container image gives you /v1/scrape and /v1/crawl but leaves
 * /v1/search returning that error, and the symptom (analysis finds no sources
 * for anything, forever) looks nothing like the cause.
 */

import type { ApiErrorDefinition } from './types.js'

export const CRW_ERRORS: Record<number, ApiErrorDefinition | ApiErrorDefinition[]> = {
  // Synthetic status for network/DNS/timeout — by far the most likely failure
  // for a service that lives in the operator's own compose file.
  0: {
    type: 'outage',
    message: 'Could not reach the retrieval service (fastCRW).',
    action:
      'Check the container is running, then check the address. fastCRW normally runs from its own compose project, which puts it on a DIFFERENT Docker network to Aperture — so its service name will not resolve. Use the published host port (http://host.docker.internal:3000 on Docker Desktop, or the host LAN IP). Only use http://crw:3000 if both are on one network. Never localhost: inside a container that is Aperture itself.',
    severity: 'error',
  },
  400: {
    type: 'validation',
    message: 'The retrieval service rejected the request.',
    action: 'Check the search settings in Settings > Integrations > Retrieval',
    severity: 'error',
  },
  401: {
    type: 'auth',
    message: 'The retrieval service refused the configured API key.',
    action: 'Check the key in Settings > Integrations > Retrieval, or clear it if the service needs none',
    severity: 'error',
  },
  403: {
    type: 'auth',
    message: 'The retrieval service refused the configured API key.',
    action: 'Check the key in Settings > Integrations > Retrieval, or clear it if the service needs none',
    severity: 'error',
  },
  404: {
    type: 'validation',
    message: 'The retrieval endpoint was not found at that address.',
    action:
      'Check the base URL — it should be the service root (http://crw:3000), without a path. A 404 usually means the path already includes /v1.',
    severity: 'error',
  },
  422: {
    type: 'validation',
    message: 'The retrieval service could not process the search parameters.',
    action: 'Lower the result count or content limit in Settings > Integrations > Retrieval',
    severity: 'error',
  },
  429: {
    type: 'rate_limit',
    message: 'The retrieval service is rate limiting. Its upstream search engines throttle a fast crawl.',
    action: 'Will retry automatically. Slow the analysis job if this persists.',
    autoRetry: true,
    retryAfterSeconds: 60,
    severity: 'warning',
  },
  500: {
    type: 'outage',
    message: 'The retrieval service errored. Its search backend may be down.',
    action: 'Check the fastCRW and SearXNG container logs',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'warning',
  },
  501: {
    // What CRW answers when /v1/search has no SearXNG behind it.
    type: 'validation',
    message: 'Search is disabled on the retrieval service — it has no search backend configured.',
    action:
      'Start fastCRW with its Compose file (which brings up the SearXNG sidecar), or point it at an existing SearXNG with CRW_SEARCH__SEARCH_BACKEND_URL.',
    severity: 'error',
  },
  502: {
    type: 'outage',
    message: 'The retrieval service could not reach its search backend.',
    action: 'Check the SearXNG sidecar is running and reachable from fastCRW',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'warning',
  },
  503: {
    type: 'outage',
    message: 'The retrieval service is unavailable.',
    action: 'Check the fastCRW container is healthy',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'warning',
  },
  504: {
    type: 'outage',
    message: 'The retrieval request timed out.',
    action:
      'Scraping several pages is slow. Raise the timeout, or lower the result count, in Settings > Integrations > Retrieval.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
}

/**
 * A body saying search is switched off can arrive on more than one status
 * depending on how the service is configured, so it is matched on text too and
 * mapped onto the 501 definition above.
 */
export const CRW_ERROR_PATTERNS: Record<string, { status: number; index: number }> = {
  search_disabled: { status: 501, index: 0 },
  'search is disabled': { status: 501, index: 0 },
  'no search backend': { status: 501, index: 0 },
}
