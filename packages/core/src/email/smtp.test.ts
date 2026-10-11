/**
 * The transport against a fake SMTP server on localhost — no real mail server,
 * no database. What these pin is what only exists on the wire: that the
 * STARTTLS mode refuses BEFORE the password is sent when the server cannot
 * upgrade, what a sent message actually carries, and that each kind of
 * refusal comes back as the failure the card will name.
 *
 * The fake speaks just enough SMTP for nodemailer: a greeting, EHLO
 * advertising AUTH PLAIN only (so the login is one line the test can read),
 * no STARTTLS and no PIPELINING (so commands arrive one at a time).
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'

import { DEFAULT_SMTP_CONFIG, type SmtpConfig } from './rules.js'
import { sendManyWithSmtp, sendWithSmtp, verifySmtp } from './smtp.js'

interface FakeReplies {
  auth?: string
  mailFrom?: string
  rcptTo?: string
  /** Leave AUTH out of the EHLO reply, as a relay that only takes a login over TLS does. */
  hideAuth?: boolean
  /** Accept the connection and never say anything. */
  silent?: boolean
}

interface FakeSmtp {
  port: number
  /** Every command line received, in order, across all connections. */
  commands: string[]
  /** Each message's DATA, dot-unstuffed, lines joined with CRLF. */
  messages: string[]
  connections: number
}

const openServers = new Set<Server>()
const openSockets = new Set<Socket>()
afterEach(() => {
  for (const socket of openSockets) socket.destroy()
  openSockets.clear()
  for (const server of openServers) server.close()
  openServers.clear()
})

async function fakeSmtp(replies: FakeReplies = {}): Promise<FakeSmtp> {
  const state: FakeSmtp = { port: 0, commands: [], messages: [], connections: 0 }
  const server = createServer((socket) => {
    state.connections++
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
    socket.on('error', () => {})
    let buffer = ''
    let data: string[] | null = null
    const reply = (line: string) => socket.write(`${line}\r\n`)

    if (replies.silent) return
    reply('220 fake.test ESMTP ready')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') {
            state.messages.push(data.join('\r\n'))
            data = null
            reply('250 2.0.0 Ok: queued as FAKE1')
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line)
          }
          continue
        }
        state.commands.push(line)
        const verb = line.toUpperCase()
        if (verb.startsWith('EHLO')) socket.write(replies.hideAuth ? '250 fake.test\r\n' : '250-fake.test\r\n250 AUTH PLAIN\r\n')
        else if (verb.startsWith('HELO')) reply('250 fake.test')
        else if (verb.startsWith('STARTTLS')) reply('502 5.5.1 STARTTLS not available')
        else if (verb.startsWith('AUTH')) reply(replies.auth ?? '235 2.7.0 Authentication successful')
        else if (verb.startsWith('MAIL FROM')) reply(replies.mailFrom ?? '250 2.1.0 Ok')
        else if (verb.startsWith('RCPT TO')) reply(replies.rcptTo ?? '250 2.1.5 Ok')
        else if (verb === 'DATA') {
          data = []
          reply('354 End data with <CR><LF>.<CR><LF>')
        } else if (verb === 'RSET' || verb === 'NOOP') reply('250 2.0.0 Ok')
        else if (verb === 'QUIT') {
          reply('221 2.0.0 Bye')
          socket.end()
        } else reply('502 5.5.2 Command not recognized')
      }
    })
  })
  openServers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.port = (server.address() as AddressInfo).port
  return state
}

function configFor(fake: FakeSmtp, overrides: Partial<SmtpConfig> = {}): SmtpConfig {
  return {
    ...DEFAULT_SMTP_CONFIG,
    enabled: true,
    host: '127.0.0.1',
    port: fake.port,
    security: 'none',
    username: 'aperture@example.com',
    password: 'hunter2',
    fromAddress: 'aperture@example.com',
    ...overrides,
  }
}

/** What AUTH PLAIN carries for these credentials, to look for in (or not in) the transcript. */
const plainPayload = (user: string, pass: string) => Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64')

const sender = { name: 'Home cinema', address: 'aperture@example.com' }

/** Every test talks to a socket, so a regression tends to hang rather than fail; this names it. */
const LIMIT = { timeout: 20_000 }

// ---------------------------------------------------------------- the password

test('STARTTLS mode stops at a server that cannot upgrade, before the password is sent', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcome = await verifySmtp(configFor(fake, { security: 'starttls' }))

  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.failure, 'tlsUnavailable')
  assert.ok(fake.commands.some((c) => c.toUpperCase() === 'STARTTLS'), fake.commands.join(' | '))
  assert.ok(!fake.commands.some((c) => c.toUpperCase().startsWith('AUTH')), fake.commands.join(' | '))
  const payload = plainPayload('aperture@example.com', 'hunter2')
  assert.ok(!fake.commands.some((c) => c.includes(payload)))
})

test('a check connects and logs in with the configured credentials', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcome = await verifySmtp(configFor(fake))

  assert.deepEqual(outcome, { ok: true, value: true })
  assert.ok(
    fake.commands.includes(`AUTH PLAIN ${plainPayload('aperture@example.com', 'hunter2')}`),
    fake.commands.join(' | ')
  )
  assert.equal(fake.messages.length, 0, 'a check sends nothing')
})

test('no username means no login attempt', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcome = await verifySmtp(configFor(fake, { username: '', password: '' }))

  assert.equal(outcome.ok, true)
  assert.ok(!fake.commands.some((c) => c.toUpperCase().startsWith('AUTH')), fake.commands.join(' | '))
})

test('a refused login comes back as a refused login, with the server words', LIMIT, async () => {
  const fake = await fakeSmtp({ auth: '535 5.7.8 Authentication credentials invalid' })
  const outcome = await verifySmtp(configFor(fake))

  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.equal(outcome.failure, 'auth')
  assert.match(outcome.detail, /535 5\.7\.8/)
  assert.ok(!outcome.detail.includes(plainPayload('aperture@example.com', 'hunter2')))
  assert.ok(!outcome.detail.includes('hunter2'))
})

// ---------------------------------------------------------------- the message

test('a sent message carries the sender, the subject, the text and the machine-sent mark', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcome = await sendWithSmtp(configFor(fake), sender, {
    to: 'viewer@example.com',
    subject: 'Something to watch',
    text: 'A friend recommended a film.\n.Dot at the start of a line survives.',
  })

  assert.equal(outcome.ok, true, outcome.ok ? '' : `${outcome.failure}: ${outcome.detail}`)
  assert.ok(fake.commands.some((c) => /^MAIL FROM:<aperture@example\.com>/i.test(c)), fake.commands.join(' | '))
  assert.ok(fake.commands.some((c) => /^RCPT TO:<viewer@example\.com>/i.test(c)), fake.commands.join(' | '))
  assert.equal(fake.messages.length, 1)
  const message = fake.messages[0]
  assert.match(message, /^From: "?Home cinema"? <aperture@example\.com>$/m)
  assert.match(message, /^To: viewer@example\.com$/m)
  assert.match(message, /^Subject: Something to watch$/m)
  assert.match(message, /^Auto-Submitted: auto-generated$/m)
  assert.match(message, /A friend recommended a film\./)
  assert.match(message, /^\.Dot at the start of a line survives\.$/m)
})

test('a subject with a line break cannot add a header', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcome = await sendWithSmtp(configFor(fake), sender, {
    to: 'viewer@example.com',
    subject: 'Hello\r\nBcc: victim@example.com',
    text: 'Hi',
  })

  assert.equal(outcome.ok, true)
  assert.ok(!fake.commands.some((c) => /victim@example\.com/i.test(c)), fake.commands.join(' | '))
  assert.doesNotMatch(fake.messages[0], /^Bcc:/im)
})

test('anything but one plain recipient address is refused without connecting', LIMIT, async () => {
  const fake = await fakeSmtp()
  for (const to of ['viewer@example.com, other@example.com', 'Viewer <viewer@example.com>', 'not-an-address']) {
    const outcome = await sendWithSmtp(configFor(fake), sender, { to, subject: 'x', text: 'x' })
    assert.equal(outcome.ok === false && outcome.failure, 'recipient', to)
  }
  assert.equal(fake.connections, 0)
})

test('a refused From address names the sender as the problem', LIMIT, async () => {
  const fake = await fakeSmtp({ mailFrom: '553 5.7.1 Sender address rejected: not owned by user' })
  const outcome = await sendWithSmtp(configFor(fake), sender, {
    to: 'viewer@example.com',
    subject: 'x',
    text: 'x',
  })

  assert.equal(outcome.ok === false && outcome.failure, 'sender')
})

test('a refused recipient names the recipient as the problem', LIMIT, async () => {
  const fake = await fakeSmtp({ rcptTo: '550 5.1.1 No such user here' })
  const outcome = await sendWithSmtp(configFor(fake), sender, {
    to: 'viewer@example.com',
    subject: 'x',
    text: 'x',
  })

  assert.equal(outcome.ok === false && outcome.failure, 'recipient')
})

// ---------------------------------------------------------------- the network

test('a port with nothing listening reads as refused', LIMIT, async () => {
  const fake = await fakeSmtp()
  const closedPort = fake.port
  await Promise.all([...openServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  openServers.clear()

  const outcome = await verifySmtp(configFor(fake, { port: closedPort }))
  assert.equal(outcome.ok === false && outcome.failure, 'refused')
})

// ---------------------------------------------------------------- a login that is never skipped

test('a server that hides AUTH is still asked to log in, and its refusal is reported', LIMIT, async () => {
  // Without forcing, nodemailer skips the login when AUTH is not advertised,
  // and the check passed with any password at all.
  const fake = await fakeSmtp({ hideAuth: true, auth: '503 5.5.1 Error: authentication not enabled' })
  const outcome = await verifySmtp(configFor(fake))

  assert.equal(outcome.ok === false && outcome.failure, 'authUnavailable')
  assert.ok(fake.commands.some((c) => c.toUpperCase().startsWith('AUTH')), fake.commands.join(' | '))
})

test('a server that hides AUTH but takes the login passes the check', LIMIT, async () => {
  const fake = await fakeSmtp({ hideAuth: true })
  const outcome = await verifySmtp(configFor(fake))

  assert.equal(outcome.ok, true, outcome.ok ? '' : `${outcome.failure}: ${outcome.detail}`)
})

test('without a username a server that hides AUTH is not asked for one', LIMIT, async () => {
  const fake = await fakeSmtp({ hideAuth: true })
  const outcome = await verifySmtp(configFor(fake, { username: '', password: '' }))

  assert.equal(outcome.ok, true)
  assert.ok(!fake.commands.some((c) => c.toUpperCase().startsWith('AUTH')), fake.commands.join(' | '))
})

test('a refusal to relay names relaying, not the address', LIMIT, async () => {
  const fake = await fakeSmtp({ rcptTo: '554 5.7.1 <viewer@example.com>: Relay access denied' })
  const outcome = await sendWithSmtp(configFor(fake), sender, { to: 'viewer@example.com', subject: 'x', text: 'x' })

  assert.equal(outcome.ok === false && outcome.failure, 'relayDenied')
})

// ---------------------------------------------------------------- refusing to guess

test('no mail server means no connection, not one to localhost', LIMIT, async () => {
  const noHost = { ...DEFAULT_SMTP_CONFIG, host: '', fromAddress: 'aperture@example.com' }
  const checked = await verifySmtp(noHost)
  assert.equal(checked.ok === false && checked.failure, 'notConfigured')
  const sent = await sendWithSmtp(noHost, sender, { to: 'viewer@example.com', subject: 'x', text: 'x' })
  assert.equal(sent.ok === false && sent.failure, 'notConfigured')
  const many = await sendManyWithSmtp(noHost, sender, [{ to: 'viewer@example.com', subject: 'x', text: 'x' }])
  assert.equal(many[0].ok === false && many[0].failure, 'notConfigured')
})

test('a server that never answers is given up on at the deadline', LIMIT, async () => {
  const fake = await fakeSmtp({ silent: true })
  const started = Date.now()
  const outcome = await verifySmtp(configFor(fake), { deadlineMs: 300 })

  assert.equal(outcome.ok === false && outcome.failure, 'timeout')
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started}ms`)
})

// ---------------------------------------------------------------- a batch

const message = (to: string) => ({ to, subject: `For ${to}`, text: 'Hi' })

test('a batch logs in once and sends every message over one connection', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcomes = await sendManyWithSmtp(configFor(fake), sender, [
    message('a@example.com'),
    message('b@example.com'),
    message('c@example.com'),
  ])

  assert.deepEqual(
    outcomes.map((o) => o.ok),
    [true, true, true]
  )
  assert.equal(fake.messages.length, 3)
  assert.equal(fake.connections, 1)
  assert.equal(fake.commands.filter((c) => c.toUpperCase().startsWith('AUTH')).length, 1)
})

test('a refused recipient costs only its own message', LIMIT, async () => {
  const fake = await fakeSmtp()
  const outcomes = await sendManyWithSmtp(configFor(fake), sender, [
    message('a@example.com'),
    message('not an address'),
    message('c@example.com'),
  ])

  assert.deepEqual(
    outcomes.map((o) => (o.ok ? 'sent' : o.failure)),
    ['sent', 'recipient', 'sent']
  )
  assert.equal(fake.messages.length, 2)
})

test('a refused login ends the batch without trying the rest', LIMIT, async () => {
  const fake = await fakeSmtp({ auth: '535 5.7.8 Authentication credentials invalid' })
  const outcomes = await sendManyWithSmtp(configFor(fake), sender, [
    message('a@example.com'),
    message('b@example.com'),
    message('c@example.com'),
  ])

  assert.deepEqual(
    outcomes.map((o) => (o.ok ? 'sent' : o.failure)),
    ['auth', 'auth', 'auth']
  )
  // One login attempt, not one per recipient — repeating a refused login is how an account gets locked.
  assert.equal(fake.commands.filter((c) => c.toUpperCase().startsWith('AUTH')).length, 1)
  assert.ok(outcomes[2].ok === false && outcomes[2].detail.startsWith('Not attempted after:'))
})
