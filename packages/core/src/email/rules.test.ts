import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SMTP_CONFIG,
  SMTP_DEFAULT_PORTS,
  buildTransportOptions,
  classifySmtpFailure,
  isEmailAddress,
  sanitizeSmtpConfig,
  singleLine,
  smtpConfigError,
  smtpFailureDetail,
  smtpHostProblem,
  smtpProblems,
  storedPasswordFor,
  type SmtpConfig,
} from './rules.js'

const configured: SmtpConfig = {
  ...DEFAULT_SMTP_CONFIG,
  enabled: true,
  host: 'smtp.example.com',
  username: 'aperture@example.com',
  password: 'secret',
  fromAddress: 'aperture@example.com',
}

// ---------------------------------------------------------------- stored config

test('sending is off unless something explicitly turned it on', () => {
  assert.equal(DEFAULT_SMTP_CONFIG.enabled, false)
  assert.equal(sanitizeSmtpConfig(undefined).enabled, false)
  assert.equal(sanitizeSmtpConfig({}).enabled, false)
  // A stored string is not a switch.
  assert.equal(sanitizeSmtpConfig({ enabled: 'true' as unknown as boolean }).enabled, false)
  assert.equal(sanitizeSmtpConfig({ enabled: true }).enabled, true)
})

test('a missing or broken port takes the convention for the stored mode, never 0', () => {
  // Number(null) is 0, so coercing before checking absence would store port 0.
  assert.equal(sanitizeSmtpConfig({ port: null as unknown as number }).port, SMTP_DEFAULT_PORTS.starttls)
  assert.equal(sanitizeSmtpConfig({ security: 'tls' }).port, 465)
  assert.equal(sanitizeSmtpConfig({ security: 'tls', port: 0 }).port, 465)
  assert.equal(sanitizeSmtpConfig({ security: 'none', port: 70000 }).port, 25)
  assert.equal(sanitizeSmtpConfig({ port: 2.5 }).port, 587)
  // A numeric string from an older blob still reads.
  assert.equal(sanitizeSmtpConfig({ port: '2525' as unknown as number }).port, 2525)
})

test('an unknown security mode falls back to the one that never sends a password in the clear', () => {
  assert.equal(sanitizeSmtpConfig({ security: 'ssl' as never }).security, 'starttls')
})

test('every text field is trimmed, the password included', () => {
  const config = sanitizeSmtpConfig({
    host: '  smtp.example.com ',
    username: ' me ',
    password: 'abcd efgh ijkl mnop\n',
    fromAddress: ' me@example.com ',
    fromName: '  Home cinema ',
  })
  assert.equal(config.host, 'smtp.example.com')
  assert.equal(config.username, 'me')
  // Inner spaces are the password's own (Gmail shows app passwords grouped).
  assert.equal(config.password, 'abcd efgh ijkl mnop')
  assert.equal(config.fromAddress, 'me@example.com')
  assert.equal(config.fromName, 'Home cinema')
})

// ---------------------------------------------------------------- what is missing

test('a complete config has no problems, and each missing piece is named', () => {
  assert.deepEqual(smtpProblems(configured), [])
  assert.deepEqual(smtpProblems({ ...configured, host: '' }), ['host'])
  assert.deepEqual(smtpProblems({ ...configured, fromAddress: '' }), ['fromAddress'])
  assert.deepEqual(smtpProblems({ ...configured, fromAddress: 'Aperture <a@example.com>' }), ['fromAddress'])
  assert.deepEqual(smtpProblems({ ...configured, password: '' }), ['password'])
})

test('no login is a complete config — a local relay takes mail without one', () => {
  assert.deepEqual(smtpProblems({ ...configured, username: '', password: '' }), [])
})

// ---------------------------------------------------------------- write-time checks

test('a URL or a host:port pasted into the host field is refused with what to do instead', () => {
  assert.equal(smtpHostProblem('smtps://smtp.example.com'), 'scheme')
  assert.equal(smtpHostProblem('smtp.example.com:587'), 'port')
  assert.equal(smtpHostProblem('smtp.example.com/'), 'characters')
  assert.equal(smtpHostProblem('smtp example.com'), 'characters')
  assert.match(smtpConfigError({ ...configured, host: 'smtp.example.com:587' }) ?? '', /Port field/)
})

test('host names, IPv4 and IPv6 literals and container names are all accepted', () => {
  for (const host of ['smtp.example.com', '192.168.1.10', '::1', 'fe80::1', 'mailrelay', 'postfix_relay', '']) {
    assert.equal(smtpHostProblem(host), null, host)
  }
})

test('nothing that could start a header of its own is stored', () => {
  assert.notEqual(smtpConfigError({ ...configured, fromName: 'Aperture\r\nBcc: victim@example.com' }), null)
  assert.notEqual(smtpConfigError({ ...configured, fromAddress: 'a@example.com\r\nBcc: b@example.com' }), null)
  assert.notEqual(smtpConfigError({ ...configured, username: 'me\n' }), null)
  assert.equal(smtpConfigError(configured), null)
})

test('an address is one bare address and nothing more', () => {
  for (const ok of ['a@example.com', 'first.last+tag@sub.example.co.uk', 'root@localhost']) {
    assert.equal(isEmailAddress(ok), true, ok)
  }
  for (const bad of [
    '',
    'example.com',
    '@example.com',
    'a@',
    'a@@example.com',
    'Name <a@example.com>',
    'a@example.com, b@example.com',
    'a@example.com;b@example.com',
    'a @example.com',
    'a@example.com\n',
    null,
    42,
  ]) {
    assert.equal(isEmailAddress(bad), false, String(bad))
  }
})

// ---------------------------------------------------------------- the stored password

test('the stored password is sent only to the host it was saved for', () => {
  assert.equal(storedPasswordFor(configured, 'smtp.example.com'), 'secret')
  // DNS names are case-insensitive, and a pasted space is not a different host.
  assert.equal(storedPasswordFor(configured, ' SMTP.Example.com '), 'secret')
  assert.equal(storedPasswordFor(configured, 'attacker.example.net'), '')
  assert.equal(storedPasswordFor(configured, ''), '')
  // Nothing stored yet means nothing to hand over, whatever the host.
  assert.equal(storedPasswordFor({ ...configured, host: '' }, ''), '')
})

// ---------------------------------------------------------------- nodemailer options

test('STARTTLS is required, not opportunistic, so a server without it never sees the password', () => {
  const options = buildTransportOptions(configured)
  assert.equal(options.secure, false)
  assert.equal(options.requireTLS, true)
  assert.equal(options.ignoreTLS, false)
  assert.deepEqual(options.auth, { user: 'aperture@example.com', pass: 'secret' })
})

test('implicit TLS is secure from the first byte, and none never upgrades', () => {
  const tls = buildTransportOptions({ ...configured, security: 'tls', port: 465 })
  assert.equal(tls.secure, true)
  assert.equal(tls.requireTLS, false)
  const none = buildTransportOptions({ ...configured, security: 'none', port: 25 })
  assert.equal(none.secure, false)
  assert.equal(none.requireTLS, false)
  assert.equal(none.ignoreTLS, true)
})

test('certificate checking is skipped only when asked, and never matters without TLS', () => {
  assert.equal(buildTransportOptions(configured).tls, undefined)
  assert.deepEqual(buildTransportOptions({ ...configured, allowSelfSigned: true }).tls, { rejectUnauthorized: false })
  assert.equal(buildTransportOptions({ ...configured, security: 'none', allowSelfSigned: true }).tls, undefined)
})

test('no username means no login attempt at all', () => {
  assert.equal(buildTransportOptions({ ...configured, username: '', password: '' }).auth, undefined)
})

test('a message can never be told to read a file or fetch a URL', () => {
  const options = buildTransportOptions(configured)
  assert.equal(options.disableFileAccess, true)
  assert.equal(options.disableUrlAccess, true)
})

test('timeouts are sized for someone waiting on a button, not for a mail daemon', () => {
  const options = buildTransportOptions(configured)
  for (const value of [options.connectionTimeout, options.greetingTimeout, options.socketTimeout]) {
    assert.ok(typeof value === 'number' && value > 0 && value <= 60_000, String(value))
  }
})

// ---------------------------------------------------------------- reading a failure

const starttls587 = { port: 587, security: 'starttls' } as const

/** The shape nodemailer hands back: its own code, the message, and whatever the server said. */
function nodemailerError(message: string, code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...extra })
}

test('a refused login reads as a refused login', () => {
  const err = nodemailerError('Invalid login: 535 5.7.8 Username and Password not accepted', 'EAUTH', {
    responseCode: 535,
    command: 'AUTH PLAIN',
  })
  assert.equal(classifySmtpFailure(err, starttls587), 'auth')
})

test('a server without STARTTLS under the STARTTLS mode reads as unavailable, not as a broken handshake', () => {
  const err = nodemailerError('Error upgrading connection with STARTTLS: 502 5.5.1 Unrecognized command', 'ETLS', {
    responseCode: 502,
    command: 'STARTTLS',
  })
  assert.equal(classifySmtpFailure(err, starttls587), 'tlsUnavailable')
})

test('nodemailer overwrites a socket error code, so a certificate failure is read off its message', () => {
  // Both arrive with nodemailer's coarse code; only the message names the cause.
  assert.equal(classifySmtpFailure(nodemailerError('self-signed certificate', 'ESOCKET'), starttls587), 'certificate')
  assert.equal(
    classifySmtpFailure(nodemailerError('Error initiating TLS - unable to verify the first certificate', 'ETLS'), starttls587),
    'certificate'
  )
  assert.equal(
    classifySmtpFailure(
      nodemailerError("Hostname/IP does not match certificate's altnames: Host: mail.example.com", 'ESOCKET'),
      starttls587
    ),
    'certificate'
  )
})

test('implicit TLS against a plain port reads as a mismatch, not a socket error', () => {
  const err = nodemailerError(
    'C0B7F5D8A07F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number',
    'ESOCKET'
  )
  assert.equal(classifySmtpFailure(err, { port: 587, security: 'tls' }), 'tlsMismatch')
})

test('a greeting that never comes on 465 under a plain mode is the mismatch, elsewhere a timeout', () => {
  const err = nodemailerError('Greeting never received', 'ETIMEDOUT', { command: 'CONN' })
  assert.equal(classifySmtpFailure(err, { port: 465, security: 'starttls' }), 'tlsMismatch')
  assert.equal(classifySmtpFailure(err, { port: 465, security: 'none' }), 'tlsMismatch')
  assert.equal(classifySmtpFailure(err, { port: 2525, security: 'starttls' }), 'timeout')
  assert.equal(classifySmtpFailure(err, { port: 465, security: 'tls' }), 'timeout')
})

test('530 is a login demand, unless it is the server demanding encryption', () => {
  assert.equal(
    classifySmtpFailure(
      nodemailerError('Mail command failed: 530 5.7.0 Authentication Required', 'EENVELOPE', {
        responseCode: 530,
        command: 'MAIL FROM',
      }),
      starttls587
    ),
    'authRequired'
  )
  assert.equal(
    classifySmtpFailure(
      nodemailerError('Mail command failed: 530 5.7.0 Must issue a STARTTLS command first', 'EENVELOPE', {
        responseCode: 530,
        command: 'MAIL FROM',
      }),
      { port: 25, security: 'none' }
    ),
    'tlsRequired'
  )
})

test('an envelope refusal names which half was refused', () => {
  assert.equal(
    classifySmtpFailure(
      nodemailerError('Mail command failed: 553 5.7.1 Sender address rejected: not owned by user', 'EENVELOPE', {
        responseCode: 553,
        command: 'MAIL FROM',
      }),
      starttls587
    ),
    'sender'
  )
  assert.equal(
    classifySmtpFailure(
      nodemailerError("Can't send mail - all recipients were rejected: 550 5.1.1 No such user", 'EENVELOPE', {
        responseCode: 550,
        command: 'RCPT TO',
      }),
      starttls587
    ),
    'recipient'
  )
})

test('an envelope refusal that happens to mention a timeout is still a refusal', () => {
  const err = nodemailerError('Mail command failed: 550 5.7.1 Sender timed out of the allow list', 'EENVELOPE', {
    responseCode: 550,
    command: 'MAIL FROM',
  })
  assert.equal(classifySmtpFailure(err, starttls587), 'sender')
})

test('the network failures are told apart', () => {
  assert.equal(classifySmtpFailure(nodemailerError('getaddrinfo ENOTFOUND smtp.exmaple.com', 'EDNS'), starttls587), 'dns')
  assert.equal(
    classifySmtpFailure(nodemailerError('connect ECONNREFUSED 127.0.0.1:587', 'ESOCKET'), starttls587),
    'refused'
  )
  assert.equal(classifySmtpFailure(nodemailerError('Connection timeout', 'ETIMEDOUT'), starttls587), 'timeout')
  assert.equal(classifySmtpFailure(nodemailerError('read ECONNRESET', 'ESOCKET'), starttls587), 'connection')
  assert.equal(classifySmtpFailure(new Error('something else entirely'), starttls587), 'unknown')
  assert.equal(classifySmtpFailure('not even an error', starttls587), 'unknown')
})

test('the detail keeps the server words on one line and clipped', () => {
  assert.equal(smtpFailureDetail(new Error('Invalid login:\r\n535 5.7.8 nope')), 'Invalid login: 535 5.7.8 nope')
  const long = smtpFailureDetail(new Error('x'.repeat(1000)))
  assert.ok(long.length <= 300, String(long.length))
  assert.ok(long.endsWith('…'))
})

test('a subject cannot carry a header of its own', () => {
  assert.equal(singleLine('Hello\r\nBcc: victim@example.com'), 'Hello Bcc: victim@example.com')
})
