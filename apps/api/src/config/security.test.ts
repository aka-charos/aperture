/**
 * Executable checks for the security posture.
 *
 * These assert behaviour against the exact objects the server registers — the
 * helmet options and rate-limit configs are exported for that reason. No
 * database is involved, so this runs anywhere.
 *
 *   node --import tsx --test apps/api/src/config/security.test.ts
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

import {
  helmetOptions,
  robotsTagHook,
  isTrustedSetupSource,
  trustProxy,
  useSecureCookies,
  passwordlessLoginPermitted,
  apiDocsMode,
  deploymentMode,
} from './security.js'
import {
  getDeploymentPosture,
  getObservation,
  noteRequest,
  resetObservation,
  warnOnWeakSecurityPosture,
} from './deploymentPosture.js'
import {
  buildTrustProxyOption,
  getProxyTrustState,
  proxyTrustIsEnvManaged,
  setTrustedProxiesForTest,
  validateProxyEntries,
} from './proxyTrust.js'
import { loginRateLimit } from './rateLimits.js'
import { requireAdmin } from '../plugins/auth.js'

/** Snapshot and restore the env vars these functions read. */
const ENV_KEYS = [
  'NODE_ENV',
  'TRUST_PROXY',
  'COOKIE_SECURE',
  'ALLOW_PASSWORDLESS_LOGIN',
  'API_DOCS',
  'SETUP_ALLOW_REMOTE',
  'CSP_REPORT_ONLY',
  'DEPLOYMENT_MODE',
  'HOST',
]

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  try {
    for (const k of ENV_KEYS) delete process.env[k]
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
    return fn()
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

describe('security headers', () => {
  test('emits the directives that matter, and enforces (not report-only) by default', async () => {
    const app = await withEnv({ NODE_ENV: 'production' }, async () => {
      const f = Fastify()
      await f.register(helmet, helmetOptions())
      f.get('/', async () => ({ ok: true }))
      return f
    })

    const res = await app.inject({ method: 'GET', url: '/' })
    const csp = res.headers['content-security-policy'] as string

    assert.ok(csp, 'CSP header present and enforcing')
    assert.equal(res.headers['content-security-policy-report-only'], undefined)

    // The two directives that actually contain an XSS and a clickjack.
    assert.match(csp, /script-src 'self'/)
    assert.ok(!csp.includes('unsafe-eval'), 'no unsafe-eval')
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /object-src 'none'/)
    assert.match(csp, /base-uri 'self'/)
    assert.match(csp, /form-action 'self'/)

    // Deliberate allowances — each is load-bearing for a real feature.
    assert.match(csp, /style-src[^;]*fonts\.googleapis\.com/)
    assert.match(csp, /font-src[^;]*fonts\.gstatic\.com/)
    assert.match(csp, /frame-src[^;]*www\.youtube\.com/)
    assert.match(csp, /connect-src 'self'/)

    // X-Frame-Options must agree with frame-ancestors, not helmet's SAMEORIGIN.
    assert.equal(res.headers['x-frame-options'], 'DENY')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['referrer-policy'], 'no-referrer')
    assert.match(res.headers['strict-transport-security'] as string, /max-age=31536000/)

    await app.close()
  })

  test('CSP_REPORT_ONLY swaps the header so nothing is blocked', async () => {
    const app = await withEnv({ NODE_ENV: 'production', CSP_REPORT_ONLY: 'true' }, async () => {
      const f = Fastify()
      await f.register(helmet, helmetOptions())
      f.get('/', async () => ({ ok: true }))
      return f
    })

    const res = await app.inject({ method: 'GET', url: '/' })
    assert.ok(res.headers['content-security-policy-report-only'])
    assert.equal(res.headers['content-security-policy'], undefined)

    await app.close()
  })

  test('every response tells search engines not to index it — including the SPA fallback', async () => {
    const f = Fastify()
    f.addHook('onRequest', robotsTagHook)
    f.get('/', async () => ({ ok: true }))

    // A real route.
    const root = await f.inject({ method: 'GET', url: '/' })
    assert.equal(root.headers['x-robots-tag'], 'noindex, nofollow')

    // And an unmatched path. In production these are answered by the SPA
    // fallback with 200 and the app shell, which is exactly what a crawler
    // would otherwise wander into and index.
    const unknown = await f.inject({ method: 'GET', url: '/some/deep/link' })
    assert.equal(unknown.headers['x-robots-tag'], 'noindex, nofollow')

    await f.close()
  })

  test('robots.txt ships with the web bundle and disallows everything', () => {
    // The header above is the binding half; this file is what stops well-behaved
    // crawlers fetching the pages in the first place. Asserted as a file because
    // Vite copies public/ into dist/ verbatim — if it is deleted or renamed, the
    // request falls through to the SPA fallback and returns HTML with 200, which
    // a crawler reads as "no rules, index everything".
    const robotsPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../web/public/robots.txt'
    )
    const body = readFileSync(robotsPath, 'utf8')

    assert.match(body, /^User-agent:\s*\*$/m)
    assert.match(body, /^Disallow:\s*\/$/m)
  })

  test('HSTS is withheld when cookies are not Secure (plain-HTTP LAN install)', async () => {
    const app = await withEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }, async () => {
      const f = Fastify()
      await f.register(helmet, helmetOptions())
      f.get('/', async () => ({ ok: true }))
      return f
    })

    const res = await app.inject({ method: 'GET', url: '/' })
    assert.equal(res.headers['strict-transport-security'], undefined)

    await app.close()
  })
})

describe('login rate limit', () => {
  /** Build an app whose /login carries the real production rate-limit config. */
  async function buildLoginApp() {
    const f = Fastify({ trustProxy: true })
    await f.register(rateLimit, { global: false })
    f.post('/login', { config: { rateLimit: loginRateLimit } }, async () => ({ ok: true }))
    return f
  }

  async function post(app: Awaited<ReturnType<typeof buildLoginApp>>, ip: string, username: string) {
    return app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      payload: { username, password: 'x' },
    })
  }

  test('caps attempts from one source at 20 per window', async () => {
    const app = await buildLoginApp()

    for (let i = 0; i < 20; i++) {
      const res = await post(app, '203.0.113.9', 'alice')
      assert.equal(res.statusCode, 200, `attempt ${i + 1} should pass`)
    }
    const blocked = await post(app, '203.0.113.9', 'alice')
    // 429, not 500: @fastify/rate-limit throws whatever the builder returns, so
    // it has to be an Error carrying statusCode.
    assert.equal(blocked.statusCode, 429)

    const body = blocked.json()
    assert.equal(body.statusCode, 429)
    assert.match(body.message, /Too many login attempts/)
    // Fastify fills `error` with the reason phrase; the detail is in `message`.
    assert.equal(body.error, 'Too Many Requests')

    assert.ok(blocked.headers['retry-after'], 'Retry-After is set for clients')

    await app.close()
  })

  test('REGRESSION: rotating usernames does not mint fresh buckets', async () => {
    // The first version of this limit keyed on `ip:username`, which meant a
    // password spray got a brand new bucket on every request and the limit
    // never fired. Every request below uses a different username.
    const app = await buildLoginApp()

    let blockedAt = -1
    for (let i = 0; i < 40; i++) {
      const res = await post(app, '198.51.100.7', `user-${i}`)
      if (res.statusCode === 429) {
        blockedAt = i
        break
      }
    }

    assert.notEqual(blockedAt, -1, 'username rotation must not evade the limit')
    assert.equal(blockedAt, 20, 'should block on the 21st attempt regardless of username')

    await app.close()
  })

  test('a different source gets its own budget', async () => {
    const app = await buildLoginApp()

    for (let i = 0; i < 20; i++) await post(app, '203.0.113.1', 'alice')
    assert.equal((await post(app, '203.0.113.1', 'alice')).statusCode, 429)
    assert.equal((await post(app, '203.0.113.2', 'alice')).statusCode, 200)

    await app.close()
  })
})

describe('requireAdmin', () => {
  function fakeReply() {
    const state: { code?: number; body?: unknown } = {}
    const reply = {
      status(code: number) {
        state.code = code
        return reply
      },
      send(body: unknown) {
        state.body = body
        return reply
      },
    }
    return { reply, state }
  }

  test('REGRESSION: x-internal-request no longer bypasses admin auth', async () => {
    const { reply, state } = fakeReply()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireAdmin({ headers: { 'x-internal-request': 'true' } } as any, reply as any)
    assert.equal(state.code, 401, 'the header must not grant access')
  })

  test('rejects a signed-in non-admin and admits an admin', async () => {
    const nonAdmin = fakeReply()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireAdmin({ headers: {}, user: { isAdmin: false } } as any, nonAdmin.reply as any)
    assert.equal(nonAdmin.state.code, 403)

    const admin = fakeReply()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireAdmin({ headers: {}, user: { isAdmin: true } } as any, admin.reply as any)
    assert.equal(admin.state.code, undefined, 'admin passes through untouched')
  })
})

describe('reverse-proxy and tunnel handling', () => {
  /**
   * Reproduces a Cloudflare Tunnel: cloudflared runs beside the app and proxies
   * every request over loopback, carrying the real client in X-Forwarded-For.
   */
  async function ipSeenBy(trust: boolean | number | string[], forwardedFor: string) {
    const f = Fastify({ trustProxy: trust })
    let seen = ''
    f.get('/', async (req) => {
      seen = req.ip
      return { ip: req.ip }
    })
    await f.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-forwarded-for': forwardedFor },
      remoteAddress: '127.0.0.1',
    })
    await f.close()
    return seen
  }

  test('without TRUST_PROXY every tunnel visitor collapses to one identity', async () => {
    const a = await ipSeenBy(false, '203.0.113.10')
    const b = await ipSeenBy(false, '198.51.100.20')
    assert.equal(a, '127.0.0.1')
    assert.equal(b, '127.0.0.1')
    assert.equal(a, b, 'all callers share one rate-limit bucket - limiter is useless')

    // And worse: that identity is loopback, so the first-run setup guard would
    // treat the entire internet as local.
    assert.equal(isTrustedSetupSource(a), true)
  })

  test('with the tunnel pinned, the real client is recovered', async () => {
    const trust = withEnv({ TRUST_PROXY: '127.0.0.1' }, () => trustProxy())
    assert.deepEqual(trust, ['127.0.0.1'])

    const a = await ipSeenBy(trust, '203.0.113.10')
    const b = await ipSeenBy(trust, '198.51.100.20')
    assert.equal(a, '203.0.113.10')
    assert.equal(b, '198.51.100.20')
    assert.notEqual(a, b, 'distinct callers get distinct buckets')

    // Remote visitors now correctly fail the setup-source check.
    assert.equal(isTrustedSetupSource(a), false)
    assert.equal(isTrustedSetupSource(b), false)
  })

  test('a LAN client through the pinned tunnel is still recognised as local', async () => {
    const trust = withEnv({ TRUST_PROXY: '127.0.0.1' }, () => trustProxy())
    const lan = await ipSeenBy(trust, '192.168.1.50')
    assert.equal(lan, '192.168.1.50')
    assert.equal(isTrustedSetupSource(lan), true)
  })
})

describe('DEPLOYMENT_MODE preset', () => {
  test('proxy mode supplies a loopback trustProxy default', () => {
    for (const alias of ['proxy', 'tunnel', 'cloudflared', 'Cloudflared']) {
      withEnv({ DEPLOYMENT_MODE: alias }, () => {
        assert.equal(deploymentMode(), 'proxy', `${alias} should resolve to proxy`)
        assert.deepEqual(trustProxy(), ['127.0.0.1', '::1'])
      })
    }
  })

  test('an explicit TRUST_PROXY always beats the mode default', () => {
    withEnv({ DEPLOYMENT_MODE: 'cloudflared', TRUST_PROXY: '172.18.0.1' }, () => {
      assert.deepEqual(trustProxy(), ['172.18.0.1'])
    })
  })

  test('direct mode is unchanged', () => {
    withEnv({}, () => {
      assert.equal(deploymentMode(), 'direct')
      assert.equal(trustProxy(), false)
    })
  })
})

describe('deployment posture diagnostics', () => {
  const ids = (env: Record<string, string | undefined>) =>
    withEnv(env, () => getDeploymentPosture().findings.map((f) => f.id))

  test('flags proxy headers arriving while they are being ignored', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('127.0.0.1', '127.0.0.1', true)

    const found = ids({ NODE_ENV: 'production' })
    assert.ok(
      found.includes('proxyHeadersIgnored'),
      'seeing X-Forwarded-For with trustProxy off is the tunnel misconfiguration'
    )
    resetObservation()
  })

  test('stays quiet when the same traffic is correctly trusted', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('203.0.113.5', '203.0.113.5', true)

    const found = ids({ NODE_ENV: 'production', TRUST_PROXY: '127.0.0.1' })
    assert.ok(!found.includes('proxyHeadersIgnored'))
    assert.ok(!found.includes('allTrafficOneAddress'))
    resetObservation()
  })

  test('notices when every caller shares one local address', () => {
    resetObservation()
    for (let i = 0; i < 8; i++) noteRequest('127.0.0.1', '127.0.0.1', false)

    const found = ids({ NODE_ENV: 'production' })
    assert.ok(found.includes('allTrafficOneAddress'))
    resetObservation()
  })

  test('does not draw conclusions from a tiny sample', () => {
    resetObservation()
    noteRequest('127.0.0.1', '127.0.0.1', false)

    const found = ids({ NODE_ENV: 'production' })
    assert.ok(!found.includes('allTrafficOneAddress'), 'one request proves nothing')
    resetObservation()
  })

  test('declaring proxy mode alone is not enough to advise a bind host', () => {
    // DEPLOYMENT_MODE says a proxy is in front, but nothing has been observed
    // forwarding and nothing is trusted, so its address is unknown. Suggesting
    // HOST=127.0.0.1 here would be a guess, and a wrong guess severs a proxy
    // that lives in another container. Silence is the correct output.
    resetObservation()
    const found = ids({ NODE_ENV: 'production', DEPLOYMENT_MODE: 'cloudflared' })
    assert.ok(!found.includes('boundToAllInterfaces'))
    assert.ok(found.includes('proxyModeWithoutTrust'), 'the real problem is still reported')
  })

  test('a clean production deployment reports no critical or warning findings', () => {
    resetObservation()
    for (let i = 0; i < 8; i++) noteRequest(`203.0.113.${i}`, `203.0.113.${i}`, true)

    const posture = withEnv(
      { NODE_ENV: 'production', DEPLOYMENT_MODE: 'cloudflared', TRUST_PROXY: '127.0.0.1', HOST: '127.0.0.1' },
      () => getDeploymentPosture()
    )
    const loud = posture.findings.filter((f) => f.severity !== 'info')
    assert.deepEqual(loud, [], `expected a clean bill, got ${JSON.stringify(loud)}`)
    resetObservation()
  })

  test('boot warnings and the panel are driven by the same findings', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('127.0.0.1', '127.0.0.1', true)

    withEnv({ NODE_ENV: 'production' }, () => {
      const warnings: string[] = []
      warnOnWeakSecurityPosture((m) => warnings.push(m))
      const loud = getDeploymentPosture().findings.filter((f) => f.severity !== 'info')
      assert.equal(warnings.length, loud.length, 'one warning per non-info finding')
      assert.ok(warnings.some((w) => /TRUST_PROXY/.test(w)))
    })
    resetObservation()
  })
})

describe('trusted proxies are editable at runtime', () => {
  /**
   * The claim this pins: Fastify accepts a *function* for trustProxy and
   * consults it per request, so changing the trusted set takes effect on a
   * live server. An earlier reading of Fastify's source concluded the opposite
   * — that the value was frozen at construction — and that mistake is why the
   * admin panel shipped read-only. If this test ever fails, the panel's
   * promise ("applies immediately") is broken.
   */
  async function appWithLiveTrust() {
    const f = Fastify({ trustProxy: buildTrustProxyOption() })
    f.get('/', async (req) => ({ ip: req.ip }))
    return f
  }

  const seenIp = async (app: Awaited<ReturnType<typeof appWithLiveTrust>>) =>
    (
      await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-forwarded-for': '203.0.113.77' },
        remoteAddress: '127.0.0.1',
      })
    ).json().ip

  test('a change applies to the very next request, with no restart', async () => {
    const app = await withEnv({}, async () => {
      setTrustedProxiesForTest([])
      return appWithLiveTrust()
    })

    assert.equal(await seenIp(app), '127.0.0.1', 'nothing trusted yet')

    setTrustedProxiesForTest(['127.0.0.1'])
    assert.equal(await seenIp(app), '203.0.113.77', 'same server instance, new answer')

    setTrustedProxiesForTest([])
    assert.equal(await seenIp(app), '127.0.0.1', 'revoking works too')

    await app.close()
  })

  test('CIDR ranges are honoured, via proxy-addr rather than our own parsing', async () => {
    const app = await withEnv({}, async () => {
      setTrustedProxiesForTest(['172.16.0.0/12'])
      return appWithLiveTrust()
    })

    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-forwarded-for': '198.51.100.4' },
      remoteAddress: '172.18.0.1',
    })
    assert.equal(res.json().ip, '198.51.100.4', '172.18.0.1 falls inside 172.16.0.0/12')

    await app.close()
  })

  test('TRUST_PROXY keeps ownership when set', () => {
    withEnv({ TRUST_PROXY: '10.0.0.5' }, () => {
      assert.equal(proxyTrustIsEnvManaged(), true)
      const state = getProxyTrustState()
      assert.deepEqual(state.entries, ['10.0.0.5'])
      assert.equal(state.envManaged, true, 'the UI must render this read-only')
      // Static value, not a function: preserves hop counts and `true`, which a
      // predicate cannot express.
      assert.deepEqual(buildTrustProxyOption(), ['10.0.0.5'])
    })
  })

  test('garbage is rejected at save time, not on every later request', () => {
    assert.throws(() => validateProxyEntries(['not-an-ip']), /not a valid IP address/)
    assert.throws(() => validateProxyEntries(['999.1.1.1']), /not a valid IP address/)
    assert.deepEqual(validateProxyEntries([' 127.0.0.1 ', '', '172.16.0.0/12']), [
      '127.0.0.1',
      '172.16.0.0/12',
    ])
    // proxy-addr's named presets are legitimate values.
    assert.deepEqual(validateProxyEntries(['loopback', 'uniquelocal']), [
      'loopback',
      'uniquelocal',
    ])
  })

  test('saving a proxy clears the "headers ignored" finding', () => {
    resetObservation()
    for (let i = 0; i < 4; i++) noteRequest('127.0.0.1', '127.0.0.1', true)

    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest([])
      assert.ok(
        getDeploymentPosture().findings.some((f) => f.id === 'proxyHeadersIgnored'),
        'flagged before'
      )

      setTrustedProxiesForTest(['127.0.0.1'])
      assert.ok(
        !getDeploymentPosture().findings.some((f) => f.id === 'proxyHeadersIgnored'),
        'and clear immediately after saving'
      )
    })

    setTrustedProxiesForTest([])
    resetObservation()
  })
})

describe('the forwarding proxy is detected, not guessed', () => {
  /**
   * The panel's whole job: an operator should never have to work out whether
   * their tunnel counts as "on this host" or "in Docker". The address is
   * observable, so the UI offers it as a one-click "trust this".
   */
  test('reports the socket peer that sent a forwarded request', () => {
    resetObservation()
    // cloudflared in its own container, forwarding on the Docker network.
    for (let i = 0; i < 3; i++) noteRequest('172.18.0.1', '172.18.0.1', true)

    const observed = getObservation()
    assert.deepEqual(observed.forwardedBy, ['172.18.0.1'])
    resetObservation()
  })

  test('does not name anything when nothing is forwarding', () => {
    resetObservation()
    for (let i = 0; i < 5; i++) noteRequest('192.168.1.20', '192.168.1.20', false)

    assert.deepEqual(getObservation().forwardedBy, [], 'no proxy, nothing to offer')
    resetObservation()
  })

  test('records the peer, not the header, so the offer cannot be forged', () => {
    resetObservation()
    // Once a proxy IS trusted, request.ip is the real client while the peer is
    // still the proxy. The suggestion must follow the peer.
    noteRequest('203.0.113.50', '127.0.0.1', true)

    assert.deepEqual(getObservation().forwardedBy, ['127.0.0.1'])
    resetObservation()
  })

  test('several forwarders are all offered', () => {
    resetObservation()
    noteRequest('127.0.0.1', '127.0.0.1', true)
    noteRequest('172.18.0.1', '172.18.0.1', true)

    assert.deepEqual(getObservation().forwardedBy.sort(), ['127.0.0.1', '172.18.0.1'])
    resetObservation()
  })
})

describe('"reached via" describes reality, not DEPLOYMENT_MODE', () => {
  /**
   * The panel used to render the DEPLOYMENT_MODE env var here, so it could sit
   * there saying "Direct" while the rows underneath had already detected a
   * proxy and were trusting it. Nobody sets that variable, so it said "Direct"
   * essentially always — a row that was wrong precisely when it mattered.
   */
  test('a detected forwarder makes it "proxy" with no env var set', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('172.28.0.1', '172.28.0.1', true)

    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest([])
      const posture = getDeploymentPosture()
      assert.equal(posture.mode, 'direct', 'DEPLOYMENT_MODE genuinely is unset')
      assert.equal(posture.reachedVia, 'proxy', 'but traffic says otherwise, and that wins')
    })
    resetObservation()
  })

  test('trusting a proxy is enough, before any traffic is sampled', () => {
    resetObservation()
    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest(['172.28.0.1'])
      assert.equal(getDeploymentPosture().reachedVia, 'proxy')
      setTrustedProxiesForTest([])
    })
  })

  test('nothing in front stays "direct"', () => {
    resetObservation()
    for (let i = 0; i < 5; i++) noteRequest('192.168.1.20', '192.168.1.20', false)

    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest([])
      assert.equal(getDeploymentPosture().reachedVia, 'direct')
    })
    resetObservation()
  })
})

describe('the bind-host advice cannot break a container setup', () => {
  /**
   * "Set HOST=127.0.0.1" is correct when the proxy shares the host, and
   * catastrophic when it does not: a proxy in its own container reaches Aperture
   * across a bridge network, so binding to loopback cuts it off completely. The
   * finding is therefore gated on every known proxy being on loopback.
   */
  test('stays silent when the proxy is on a container network', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('203.0.113.9', '172.28.0.1', true)

    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest(['172.28.0.1'])
      const ids = getDeploymentPosture().findings.map((f) => f.id)
      assert.ok(
        !ids.includes('boundToAllInterfaces'),
        'advising HOST=127.0.0.1 here would sever the proxy from the app'
      )
      setTrustedProxiesForTest([])
    })
    resetObservation()
  })

  test('still fires when the proxy really is on this host', () => {
    resetObservation()
    for (let i = 0; i < 3; i++) noteRequest('203.0.113.9', '127.0.0.1', true)

    withEnv({ NODE_ENV: 'production' }, () => {
      setTrustedProxiesForTest(['127.0.0.1'])
      const ids = getDeploymentPosture().findings.map((f) => f.id)
      assert.ok(ids.includes('boundToAllInterfaces'), 'here the advice is sound')
      setTrustedProxiesForTest([])
    })
    resetObservation()
  })
})

describe('deployment findings are renderable', () => {
  /**
   * Every finding id must have English copy, or the admin panel renders a raw
   * key like "settingsDeployment.findings.foo.title". A plain file read, not an
   * import — the API does not depend on the web app, this only checks that the
   * two halves of one feature agree.
   */
  test('every finding id has title/detail/fix in en', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, resolve } = await import('node:path')

    const here = dirname(fileURLToPath(import.meta.url))
    const enPath = resolve(here, '../../../web/src/i18n/locales/en/translation.json')

    if (!existsSync(enPath)) {
      assert.fail(`en translation not found at ${enPath} - update this path if locales moved`)
    }

    const en = JSON.parse(readFileSync(enPath, 'utf8')) as {
      settingsDeployment?: { findings?: Record<string, Record<string, string>> }
    }
    const copy = en.settingsDeployment?.findings ?? {}

    // Drive every branch that can produce a finding, and collect the ids.
    const emitted = new Set<string>()
    const collect = (env: Record<string, string | undefined>) => {
      withEnv(env, () => {
        for (const f of getDeploymentPosture().findings) {
          if (f.severity !== 'info') emitted.add(f.id)
        }
      })
    }

    resetObservation()
    for (let i = 0; i < 8; i++) noteRequest('127.0.0.1', '127.0.0.1', true)
    collect({ NODE_ENV: 'production' })
    collect({ NODE_ENV: 'production', DEPLOYMENT_MODE: 'cloudflared' })
    collect({ NODE_ENV: 'production', TRUST_PROXY: 'true' })
    collect({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      ALLOW_PASSWORDLESS_LOGIN: 'true',
      API_DOCS: 'public',
      SETUP_ALLOW_REMOTE: 'true',
      CSP_REPORT_ONLY: 'true',
    })
    resetObservation()
    for (let i = 0; i < 8; i++) noteRequest('127.0.0.1', '127.0.0.1', false)
    collect({ NODE_ENV: 'production' })
    resetObservation()

    assert.ok(emitted.size >= 8, `expected most findings to be exercised, got ${emitted.size}`)

    for (const id of emitted) {
      for (const field of ['title', 'detail', 'fix']) {
        assert.ok(
          typeof copy[id]?.[field] === 'string' && copy[id][field].length > 0,
          `missing settingsDeployment.findings.${id}.${field} in en/translation.json`
        )
      }
    }
  })
})

describe('deployment defaults', () => {
  test('production defaults are the safe ones', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      assert.equal(useSecureCookies(), true, 'Secure cookie on by default')
      assert.equal(passwordlessLoginPermitted(), false, 'passwordless gated off')
      assert.equal(apiDocsMode(), 'admin', 'Swagger not public')
      assert.equal(trustProxy(), false, 'XFF not trusted until opted in')
    })
  })

  test('development stays convenient', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
      assert.equal(useSecureCookies(), false)
      assert.equal(passwordlessLoginPermitted(), true)
      assert.equal(apiDocsMode(), 'public')
    })
  })
})
