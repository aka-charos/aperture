/**
 * Deployment posture: what this instance's security-relevant settings actually
 * resolve to, plus what live traffic says about whether they are right.
 *
 * The config half is derivable from env. The interesting half is not: whether a
 * reverse proxy sits in front is only knowable by looking at requests. An
 * instance behind a tunnel with TRUST_PROXY unset looks completely healthy from
 * config alone, while in reality every visitor shares one identity — the login
 * rate limiter degenerates to a single global bucket and the first-run setup
 * guard treats the whole internet as local. That is exactly the case this
 * module exists to catch, so it reports evidence, not guesses.
 *
 * One source of truth for two consumers: the boot-time warnings and the admin
 * panel both render `findings`, so they cannot drift apart.
 */

import {
  deploymentMode,
  useSecureCookies,
  apiDocsMode,
  setupAllowsRemote,
  passwordlessLoginPermitted,
  cspReportOnly,
  isProduction,
  isTrustedSetupSource,
  type DeploymentMode,
  type ApiDocsMode,
} from './security.js'
import { getProxyTrustState, type ProxyTrustState } from './proxyTrust.js'

export type FindingSeverity = 'critical' | 'warning' | 'info'

/**
 * `id` is a stable key, not prose: the web renders it through i18n. Any human
 * text here would be untranslatable and would duplicate the UI's copy.
 */
export interface DeploymentFinding {
  id: string
  severity: FindingSeverity
  data?: Record<string, string | number>
}

export interface DeploymentObservation {
  requestsSeen: number
  /** Requests that arrived carrying X-Forwarded-For. */
  forwardedForSeen: number
  /** Distinct `request.ip` values, capped — see DISTINCT_IP_CAP. */
  distinctClientIps: number
  /** Whether every observed client address was loopback or private. */
  allClientIpsLocal: boolean
}

export interface DeploymentPosture {
  mode: DeploymentMode
  production: boolean
  effective: {
    trustedProxies: ProxyTrustState
    cookieSecure: boolean
    apiDocs: ApiDocsMode
    setupRemoteAllowed: boolean
    passwordlessPermitted: boolean
    cspReportOnly: boolean
    bindHost: string
  }
  observed: DeploymentObservation
  findings: DeploymentFinding[]
}

/**
 * Enough distinct addresses to tell "one proxy" from "many visitors" without
 * letting the set grow with traffic. Once past the cap we stop adding; the
 * question it answers is only ever "is this 1, or clearly more than 1".
 */
const DISTINCT_IP_CAP = 50

const distinctIps = new Set<string>()
let requestsSeen = 0
let forwardedForSeen = 0
let sawNonLocalClient = false

/**
 * Record one request's shape. Called from the access-log hook, so it must stay
 * allocation-light and must never throw.
 */
export function noteRequest(ip: string | undefined, hasForwardedFor: boolean): void {
  requestsSeen++
  if (hasForwardedFor) forwardedForSeen++
  if (!ip) return
  if (distinctIps.size < DISTINCT_IP_CAP) distinctIps.add(ip)
  if (!sawNonLocalClient && !isTrustedSetupSource(ip)) sawNonLocalClient = true
}

export function getObservation(): DeploymentObservation {
  return {
    requestsSeen,
    forwardedForSeen,
    distinctClientIps: distinctIps.size,
    allClientIpsLocal: !sawNonLocalClient,
  }
}

/** Test seam. */
export function resetObservation(): void {
  distinctIps.clear()
  requestsSeen = 0
  forwardedForSeen = 0
  sawNonLocalClient = false
}

/** Enough traffic to draw a conclusion from. Below this we stay quiet. */
const MIN_SAMPLE = 5

export function getDeploymentPosture(): DeploymentPosture {
  const mode = deploymentMode()
  const proxy = getProxyTrustState()
  const production = isProduction()
  const observed = getObservation()
  const bindHost = process.env.HOST?.trim() || '0.0.0.0'

  const findings: DeploymentFinding[] = []
  const trustsNothing = !proxy.trustsAny

  // --- Evidence-based: what the traffic says -------------------------------

  if (trustsNothing && observed.forwardedForSeen > 0) {
    // Definitive: something in front is forwarding, and we are ignoring it.
    findings.push({
      id: 'proxyHeadersIgnored',
      severity: 'critical',
      data: { forwardedRequests: observed.forwardedForSeen },
    })
  } else if (
    trustsNothing &&
    observed.requestsSeen >= MIN_SAMPLE &&
    observed.distinctClientIps === 1 &&
    observed.allClientIpsLocal
  ) {
    // Circumstantial: every caller so far shares one local address. Normal for
    // a single-user LAN install, suspicious for anything public.
    findings.push({
      id: 'allTrafficOneAddress',
      severity: 'warning',
      data: { requests: observed.requestsSeen },
    })
  }

  if (mode === 'proxy' && bindHost === '0.0.0.0') {
    findings.push({ id: 'boundToAllInterfaces', severity: 'warning' })
  }

  // --- Config-based --------------------------------------------------------

  if (proxy.trustsAll) {
    findings.push({ id: 'trustProxyWideOpen', severity: 'warning' })
  }

  if (mode === 'proxy' && trustsNothing) {
    findings.push({ id: 'proxyModeWithoutTrust', severity: 'critical' })
  }

  if (production) {
    if (!useSecureCookies()) findings.push({ id: 'cookieInsecure', severity: 'critical' })
    if (passwordlessLoginPermitted()) {
      findings.push({ id: 'passwordlessPermitted', severity: 'warning' })
    }
    if (apiDocsMode() === 'public') findings.push({ id: 'docsPublic', severity: 'warning' })
    if (mode === 'direct' && trustsNothing && observed.forwardedForSeen === 0) {
      // Nothing wrong — say so, so the panel is not silent on the main question.
      findings.push({ id: 'directModeOk', severity: 'info' })
    }
  }

  if (setupAllowsRemote()) findings.push({ id: 'setupRemoteAllowed', severity: 'warning' })
  if (cspReportOnly()) findings.push({ id: 'cspReportOnly', severity: 'warning' })

  return {
    mode,
    production,
    effective: {
      trustedProxies: proxy,
      cookieSecure: useSecureCookies(),
      apiDocs: apiDocsMode(),
      setupRemoteAllowed: setupAllowsRemote(),
      passwordlessPermitted: passwordlessLoginPermitted(),
      cspReportOnly: cspReportOnly(),
      bindHost,
    },
    observed,
    findings,
  }
}

/**
 * English one-liners for the boot log only.
 *
 * The admin panel translates `id` instead; these exist because a container log
 * has no i18n and is often the only thing an operator reads.
 */
const BOOT_MESSAGES: Record<string, string> = {
  proxyHeadersIgnored:
    'Requests are arriving with X-Forwarded-For but no proxy is trusted. Every caller ' +
    'therefore shares one apparent address: the login rate limiter collapses to a single ' +
    'global bucket, and first-run setup sees remote visitors as local. Add your proxy under ' +
    'Settings > System > Deployment (applies immediately), or set TRUST_PROXY=127.0.0.1.',
  allTrafficOneAddress:
    'Every request so far has come from the same local address. If a reverse proxy or tunnel ' +
    'is in front of Aperture, add its address under Settings > System > Deployment so real ' +
    'client IPs are used.',
  proxyModeWithoutTrust:
    'DEPLOYMENT_MODE=proxy but no proxy address is trusted. Client IPs will be wrong until ' +
    'one is added under Settings > System > Deployment.',
  trustProxyWideOpen:
    'TRUST_PROXY=true trusts X-Forwarded-For from any source. A caller can then forge their ' +
    'apparent address, which lets them mint a fresh login rate-limit bucket per request and ' +
    'appear local to the first-run setup guard. Prefer listing your proxy explicitly, ' +
    'e.g. TRUST_PROXY=172.18.0.1 (or a CIDR).',
  boundToAllInterfaces:
    'A proxy is expected in front, but the app is bound to 0.0.0.0 and is therefore also ' +
    'reachable directly, bypassing it. Set HOST=127.0.0.1 if the proxy runs on this host.',
  cookieInsecure: 'COOKIE_SECURE=false: the session cookie will be sent over plain HTTP.',
  passwordlessPermitted:
    'ALLOW_PASSWORDLESS_LOGIN=true: if the admin toggle is also on, any account without a ' +
    'media-server password can be signed into by name alone.',
  docsPublic:
    'API_DOCS=public: the OpenAPI spec and Swagger UI are reachable without authentication.',
  setupRemoteAllowed:
    'SETUP_ALLOW_REMOTE=true: first-run setup is reachable from any address until setup ' +
    'completes. Unset this once the wizard is finished.',
  cspReportOnly:
    'CSP_REPORT_ONLY=true: the Content-Security-Policy is not being enforced. Intended for ' +
    'one shakedown deploy, not to be left on.',
}

/**
 * Warn at startup about settings that weaken the deployment.
 *
 * Every one of these is a legitimate choice for some install, so none is an
 * error — but each silently removes a control, and the resulting symptom shows
 * up nowhere near the cause.
 */
export function warnOnWeakSecurityPosture(warn: (msg: string) => void): void {
  for (const finding of getDeploymentPosture().findings) {
    if (finding.severity === 'info') continue
    const msg = BOOT_MESSAGES[finding.id]
    if (msg) warn(msg)
  }
}
