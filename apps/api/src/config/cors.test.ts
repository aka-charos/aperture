/**
 * Which requests carrying an Origin get through, tested against the delegator the
 * server registers. No database is involved.
 *
 *   node --import tsx --test apps/api/src/config/cors.test.ts
 */

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'

import {
  addressCouldBeRebound,
  arrivalAddress,
  configuredOrigins,
  corsDelegator,
  decideCors,
  isPublicFileRequest,
  isRoutePath,
  originCouldBeRebound,
  originMatchesArrival,
} from './cors.js'
import {
  buildTrustProxyOption,
  isTrustedPeer,
  refreshProxyTrust,
  setTrustedProxiesForTest,
} from './proxyTrust.js'

const PUBLIC = 'https://aperture.example.com'
const LAN = '192.168.1.5:3456'
const EVIL = 'https://evil.example'
const PROXY = '10.0.0.9'

const ENV_KEYS = ['NODE_ENV', 'APP_BASE_URL', 'TRUST_PROXY']
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function setEnv(env: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value
}

afterEach(() => {
  setEnv(savedEnv)
  setTrustedProxiesForTest([])
})

/** A server with the real delegator, the real trust option and a handler count. */
async function server() {
  const handled = { count: 0 }
  const app = Fastify({ trustProxy: buildTrustProxyOption() })
  await app.register(cors, {
    delegator: corsDelegator({ peerIsTrusted: isTrustedPeer, onRefused: () => {} }),
  })
  const reply = async () => {
    handled.count += 1
    return { ok: true }
  }
  app.get('/assets/index-abc.js', reply)
  app.post('/assets/index-abc.js', reply)
  app.get('/api/thing', reply)
  app.post('/api/thing', reply)
  return { app, handled }
}

function assertNoCorsHeaders(res: { headers: Record<string, unknown> }): void {
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  assert.equal(res.headers['access-control-allow-credentials'], undefined)
}

describe('an instance reached by another address', () => {
  for (const [label, appBaseUrl] of [
    ['APP_BASE_URL unset', undefined],
    ['APP_BASE_URL naming a public domain', PUBLIC],
  ] as const) {
    test(`gets its entry chunk and can sign in, with ${label}`, async () => {
      setEnv({ NODE_ENV: 'production', APP_BASE_URL: appBaseUrl })
      const { app, handled } = await server()
      const headers = { host: LAN, origin: `http://${LAN}` }

      const script = await app.inject({ method: 'GET', url: '/assets/index-abc.js', headers })
      assert.equal(script.statusCode, 200)
      assertNoCorsHeaders(script)

      const write = await app.inject({ method: 'POST', url: '/api/thing', headers })
      assert.equal(write.statusCode, 200)
      assertNoCorsHeaders(write)

      assert.equal(handled.count, 2)
    })
  }
})

describe('a foreign origin', () => {
  test('is refused on every API route, before the handler', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app, handled } = await server()
    const headers = { host: 'aperture.example.com', origin: EVIL }

    for (const method of ['GET', 'POST'] as const) {
      const res = await app.inject({ method, url: '/api/thing', headers })
      assert.equal(res.statusCode, 403)
      assertNoCorsHeaders(res)
      // The answer depends on the Origin, so a cache in front has to be told.
      assert.match(String(res.headers.vary), /origin/i)
    }
    assert.equal(handled.count, 0)
  })

  test('gets a public file with no CORS headers, so the browser keeps it from the page', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app } = await server()
    const res = await app.inject({
      method: 'GET',
      url: '/assets/index-abc.js',
      headers: { host: 'aperture.example.com', origin: EVIL },
    })
    assert.equal(res.statusCode, 200)
    assertNoCorsHeaders(res)
    assert.match(String(res.headers.vary), /origin/i)
  })

  test('cannot write outside /api either', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app, handled } = await server()
    const res = await app.inject({
      method: 'POST',
      url: '/assets/index-abc.js',
      headers: { host: 'aperture.example.com', origin: EVIL },
    })
    assert.equal(res.statusCode, 403)
    assert.equal(handled.count, 0)
  })

  test('fails its preflight, which is what keeps a custom header out of a real request', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app } = await server()
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/thing',
      headers: {
        host: 'aperture.example.com',
        origin: EVIL,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-forwarded-host',
      },
    })
    assert.equal(res.statusCode, 403)
    assertNoCorsHeaders(res)
    assert.equal(res.headers['access-control-allow-methods'], undefined)
  })
})

describe('a forged forwarded host', () => {
  test('from an untrusted peer is ignored', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app, handled } = await server()
    const res = await app.inject({
      method: 'POST',
      url: '/api/thing',
      remoteAddress: '203.0.113.7',
      headers: {
        host: 'aperture.example.com',
        origin: EVIL,
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    })
    assert.equal(res.statusCode, 403)
    assertNoCorsHeaders(res)
    assert.equal(handled.count, 0)
  })

  test('is believed by Fastify from anyone, which is why request.host is not used', async () => {
    setEnv({ NODE_ENV: 'production' })
    const app = Fastify({ trustProxy: buildTrustProxyOption() })
    app.get('/', async (request) => ({ host: request.host, protocol: request.protocol }))
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '203.0.113.7',
      headers: { host: 'real.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
    })
    assert.deepEqual(res.json(), { host: 'evil.example', protocol: 'https' })
  })

  test('let through a trusted proxy still earns no CORS headers', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    setTrustedProxiesForTest([PROXY])
    const { app } = await server()
    const res = await app.inject({
      method: 'GET',
      url: '/api/thing',
      remoteAddress: PROXY,
      headers: {
        host: 'aperture.example.com',
        origin: EVIL,
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    })
    assertNoCorsHeaders(res)
  })

  test('written ahead of what the nearest proxy wrote loses', () => {
    const arrival = arrivalAddress({
      host: 'aperture:3456',
      forwardedHost: 'evil.example, aperture.example.com',
      forwardedProto: 'https',
      encrypted: false,
      peerTrusted: true,
    })
    assert.equal(arrival.host, 'aperture.example.com')
    assert.equal(originMatchesArrival(EVIL, arrival), false)
    assert.equal(originMatchesArrival(PUBLIC, arrival), true)
  })
})

describe('behind a proxy', () => {
  const proxied = {
    host: 'aperture:3456',
    origin: 'https://other.example.com',
    'x-forwarded-host': 'other.example.com',
    'x-forwarded-proto': 'https',
  }

  test('a trusted proxy that rewrites Host vouches for the real address', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    setTrustedProxiesForTest([PROXY])
    const { app, handled } = await server()
    const res = await app.inject({
      method: 'POST',
      url: '/api/thing',
      remoteAddress: PROXY,
      headers: proxied,
    })
    assert.equal(res.statusCode, 200)
    assertNoCorsHeaders(res)
    assert.equal(handled.count, 1)
  })

  test('the same headers from a proxy nobody named prove nothing', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app, handled } = await server()
    const res = await app.inject({
      method: 'POST',
      url: '/api/thing',
      remoteAddress: PROXY,
      headers: proxied,
    })
    assert.equal(res.statusCode, 403)
    assert.equal(handled.count, 0)
  })

  test('its entry chunk still loads then, since a public file needs no proof', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
    const { app } = await server()
    const res = await app.inject({
      method: 'GET',
      url: '/assets/index-abc.js',
      remoteAddress: PROXY,
      headers: proxied,
    })
    assert.equal(res.statusCode, 200)
  })

  test('a known scheme has to match: http://x is not https://x', () => {
    const arrival = arrivalAddress({
      host: 'aperture.example.com',
      forwardedHost: undefined,
      forwardedProto: 'https',
      encrypted: false,
      peerTrusted: true,
    })
    assert.equal(arrival.scheme, 'https')
    assert.equal(originMatchesArrival('http://aperture.example.com', arrival), false)
  })

  for (const forwardedProto of ['http', 'https, http']) {
    test(`an inner proxy reporting its own hop (${forwardedProto}) does not refuse an https page`, async () => {
      setEnv({ NODE_ENV: 'production', APP_BASE_URL: PUBLIC })
      setTrustedProxiesForTest([PROXY])
      const { app, handled } = await server()
      const res = await app.inject({
        method: 'POST',
        url: '/api/thing',
        remoteAddress: PROXY,
        headers: { ...proxied, 'x-forwarded-proto': forwardedProto },
      })
      assert.equal(res.statusCode, 200)
      assert.equal(handled.count, 1)
    })
  }

  test('an undeclared proxy terminating TLS leaves the scheme unknown, not wrong', () => {
    const arrival = arrivalAddress({
      host: 'aperture.example.com',
      forwardedHost: undefined,
      forwardedProto: 'http',
      encrypted: false,
      peerTrusted: false,
    })
    assert.equal(arrival.scheme, undefined)
    assert.equal(originMatchesArrival(PUBLIC, arrival), true)
  })

  test('a TLS socket knows its own scheme', () => {
    const arrival = arrivalAddress({
      host: 'aperture.example.com',
      forwardedHost: undefined,
      forwardedProto: undefined,
      encrypted: true,
      peerTrusted: false,
    })
    assert.equal(arrival.scheme, 'https')
    assert.equal(originMatchesArrival('http://aperture.example.com', arrival), false)
  })
})

describe('a configured origin', () => {
  test('is the only thing that earns credentialed CORS headers', async () => {
    setEnv({ NODE_ENV: 'production', APP_BASE_URL: `${PUBLIC}/` })
    const { app } = await server()
    const res = await app.inject({
      method: 'GET',
      url: '/api/thing',
      headers: { host: 'internal:3456', origin: PUBLIC },
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['access-control-allow-origin'], PUBLIC)
    assert.equal(res.headers['access-control-allow-credentials'], 'true')
  })

  test('development keeps its local origins; production does not', () => {
    assert.ok(configuredOrigins({ NODE_ENV: 'development' }).includes('http://localhost:3457'))
    assert.deepEqual(configuredOrigins({ NODE_ENV: 'production' }), [])
    assert.deepEqual(
      configuredOrigins({ NODE_ENV: 'production', APP_BASE_URL: 'https://A.example.com/app/' }),
      ['https://a.example.com']
    )
    assert.deepEqual(configuredOrigins({ NODE_ENV: 'production', APP_BASE_URL: 'not a url' }), [])
  })

  test('no Origin at all takes the branch it always took', async () => {
    setEnv({ NODE_ENV: 'production' })
    const { app } = await server()
    const res = await app.inject({ method: 'GET', url: '/api/thing', headers: { host: LAN } })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['access-control-allow-origin'], undefined)
  })
})

describe('originMatchesArrival', () => {
  const arrive = (host: string | undefined) => ({ host, scheme: undefined })

  test('reads two spellings of one address as one', () => {
    assert.equal(originMatchesArrival('https://A.Example.COM', arrive('a.example.com')), true)
    assert.equal(originMatchesArrival('https://a.example.com', arrive('a.example.com:443')), true)
    assert.equal(originMatchesArrival('http://a.example.com', arrive('a.example.com:80')), true)
    assert.equal(originMatchesArrival('http://[::1]:3456', arrive('[::1]:3456')), true)
  })

  test('holds a different address apart', () => {
    assert.equal(originMatchesArrival('https://a.example.com', arrive('a.example.com:80')), false)
    assert.equal(originMatchesArrival('http://a.example.com:81', arrive('a.example.com')), false)
    assert.equal(originMatchesArrival('https://a.example.com.evil.net', arrive('a.example.com')), false)
    assert.equal(originMatchesArrival('https://evil.net', arrive('a.example.com.evil.net')), false)
  })

  test('takes neither an unusable Origin nor a Host that is more than an address', () => {
    assert.equal(originMatchesArrival('null', arrive('a.example.com')), false)
    assert.equal(originMatchesArrival('file:///x', arrive('a.example.com')), false)
    assert.equal(originMatchesArrival('https://a.example.com', arrive(undefined)), false)
    assert.equal(originMatchesArrival('https://evil.net', arrive('a.example.com@evil.net')), false)
    assert.equal(originMatchesArrival('https://evil.net', arrive('evil.net/a.example.com')), false)
    assert.equal(originMatchesArrival('https://evil.net', arrive('evil.net#')), false)
  })
})

describe('isPublicFileRequest', () => {
  test('is a read outside the routes', () => {
    assert.equal(isPublicFileRequest('GET', '/assets/index-abc.js'), true)
    assert.equal(isPublicFileRequest('HEAD', '/favicon.ico?x=1'), true)
    assert.equal(isPublicFileRequest('GET', '/'), true)
  })

  test('stops at a path segment, so a page named like a route stays a page', () => {
    assert.equal(isRoutePath('/live'), true)
    assert.equal(isRoutePath('/ready?x=1'), true)
    assert.equal(isRoutePath('/api/x'), true)
    assert.equal(isRoutePath('/livestream'), false)
    assert.equal(isRoutePath('/assets/api/x.js'), false)
  })

  test('is never a write or a route, however it is spelled', () => {
    assert.equal(isPublicFileRequest('POST', '/assets/index-abc.js'), false)
    assert.equal(isPublicFileRequest('OPTIONS', '/assets/index-abc.js'), false)
    assert.equal(isPublicFileRequest('GET', '/api/auth/me'), false)
    assert.equal(isPublicFileRequest('GET', '/%61pi/auth/me'), false)
    assert.equal(isPublicFileRequest('GET', '/health'), false)
    assert.equal(isPublicFileRequest('GET', '/ready'), false)
    assert.equal(isPublicFileRequest('GET', '/live'), false)
    assert.equal(isPublicFileRequest('GET', '/openapi/json'), false)
    assert.equal(isPublicFileRequest('GET', '/%ZZ'), false)
  })

  test('decideCors refuses the encoded spelling from a foreign origin', () => {
    assert.equal(
      decideCors({
        origin: EVIL,
        method: 'GET',
        url: '/%61pi/auth/me',
        configured: [],
        arrival: { host: 'a.example.com', scheme: undefined },
      }),
      'refuse'
    )
  })
})

describe('originCouldBeRebound', () => {
  test('a name might be another site pointed here', () => {
    assert.equal(originCouldBeRebound('http://evil.example:3456', []), true)
    assert.equal(originCouldBeRebound('http://nas.lan:3456', []), true)
    assert.equal(originCouldBeRebound('null', []), true)
  })

  test('an IP address or a loopback name cannot be', () => {
    assert.equal(originCouldBeRebound('http://192.168.1.5:3456', []), false)
    assert.equal(originCouldBeRebound('http://[fd00::1]:3456', []), false)
    assert.equal(originCouldBeRebound('http://localhost:3456', []), false)
    assert.equal(originCouldBeRebound('http://app.localhost:3456', []), false)
  })

  test('nor can a name the operator configured, or a request with no Origin', () => {
    assert.equal(originCouldBeRebound('http://nas.lan:3456', ['http://nas.lan:3456']), false)
    assert.equal(originCouldBeRebound(undefined, []), false)
  })
})

describe('addressCouldBeRebound', () => {
  test('agrees with originCouldBeRebound about the same address', () => {
    assert.equal(addressCouldBeRebound('evil.example:3456', []), true)
    assert.equal(addressCouldBeRebound('nas.lan', []), true)
    assert.equal(addressCouldBeRebound('192.168.1.5:3456', []), false)
    assert.equal(addressCouldBeRebound('[fd00::1]:3456', []), false)
    assert.equal(addressCouldBeRebound('localhost:3456', []), false)
    assert.equal(addressCouldBeRebound('nas.lan:3456', ['http://nas.lan:3456']), false)
    assert.equal(addressCouldBeRebound('aperture.example.com', [PUBLIC]), false)
  })

  test('asks for a password when the address is missing or is not an address', () => {
    assert.equal(addressCouldBeRebound(undefined, []), true)
    assert.equal(addressCouldBeRebound('192.168.1.5@evil.example', []), true)
  })
})

describe('the two public login routes', () => {
  const source = readFileSync(new URL('../routes/auth/index.ts', import.meta.url), 'utf8')

  // Switching passwordless login on takes a database, so these read the source.
  // Deleting either call fails no other test.
  test('POST /login asks for a password when the Origin could be rebound', () => {
    assert.match(
      source,
      /const passwordRequired =\s+!\(await isPasswordlessLoginEnabled\(\)\) \|\| originCouldBeRebound\(request\.headers\.origin\)/
    )
  })

  test('GET /login-options says the same for the address', () => {
    assert.match(
      source,
      /allowPasswordlessLogin:\s+passwordlessEnabled &&\s+!addressCouldBeRebound\(arrivalOf\(request, isTrustedPeer\)\.host\)/
    )
  })
})

describe('isTrustedPeer', () => {
  test('follows the stored list, trusting nothing by default', () => {
    setEnv({})
    setTrustedProxiesForTest([])
    assert.equal(isTrustedPeer(PROXY), false)
    setTrustedProxiesForTest(['10.0.0.0/8'])
    assert.equal(isTrustedPeer(PROXY), true)
    assert.equal(isTrustedPeer('192.168.1.5'), false)
    assert.equal(isTrustedPeer(undefined), false)
  })

  test('follows every form TRUST_PROXY can take', async () => {
    setEnv({ TRUST_PROXY: 'true' })
    assert.equal(isTrustedPeer('203.0.113.7'), true)
    setEnv({ TRUST_PROXY: 'false' })
    assert.equal(isTrustedPeer(PROXY), false)
    setEnv({ TRUST_PROXY: '2' })
    assert.equal(isTrustedPeer('203.0.113.7'), true)
    setEnv({ TRUST_PROXY: PROXY })
    await refreshProxyTrust()
    assert.equal(isTrustedPeer(PROXY), true)
    assert.equal(isTrustedPeer('203.0.113.7'), false)
    setEnv({ TRUST_PROXY: '172.18.0.0/16, 127.0.0.1' })
    await refreshProxyTrust()
    assert.equal(isTrustedPeer('172.18.0.4'), true)
    assert.equal(isTrustedPeer(PROXY), false)
  })

  test('agrees with Fastify about the addresses it reads', async () => {
    setEnv({})
    setTrustedProxiesForTest([PROXY])
    const app = Fastify({ trustProxy: buildTrustProxyOption() })
    app.get('/', async (request) => ({ ip: request.ip }))
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: PROXY,
      headers: { 'x-forwarded-for': '198.51.100.1' },
    })
    assert.equal(res.json().ip, '198.51.100.1')
    assert.equal(isTrustedPeer(PROXY), true)
  })
})
