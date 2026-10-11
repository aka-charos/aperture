/**
 * The one way the app sends email.
 *
 * `sendEmail` (one message) and `sendEmails` (a batch) are what a feature
 * calls: they read the saved settings once, refuse without opening a
 * connection when sending is switched off or incomplete, and fill in the
 * sender. They never throw — a notification that could not be delivered must
 * not fail the work that wanted to send it — so a caller reads the outcome and
 * decides what a failure means for it. A fan-out uses `sendEmails`, which
 * shares one connection and one login across the batch.
 *
 * A message's body comes from `renderEmail` with the recipient's
 * `emailContextFor(locale)`: their language, the instance's name and colour,
 * and the base for links back into the app.
 *
 * Whether a particular PERSON should get a particular email is deliberately not
 * decided here. That is a question about the recipient (an address on file,
 * the admin's `emailNotifications` grant, their own opt-in) and belongs with
 * the feature that sends, as one shared predicate, not inside the transport.
 */
import { getEnv } from '../config/env.js'
import type { AppLocaleCode } from '../lib/locales.js'
import { getAppName, getThemeColors } from '../settings/systemSettings.js'
import { getSmtpConfig } from './config.js'
import { appLink, emailLinkBase } from './links.js'
import {
  senderFor,
  smtpProblems,
  type EmailSender,
  type OutgoingEmail,
  type SentEmail,
  type SmtpConfig,
  type SmtpFailure,
  type SmtpOutcome,
} from './rules.js'
import { sendManyWithSmtp, sendWithSmtp } from './smtp.js'
import { emailLocale, emailText, type EmailStringKey } from './strings.js'
import { renderEmail, type EmailFrame, type RenderedEmail } from './template.js'

type Prepared = { config: SmtpConfig; sender: EmailSender } | { ok: false; failure: SmtpFailure; detail: string }

/** The saved settings and the sender, read once per call — or why nothing may be sent. */
async function prepare(): Promise<Prepared> {
  const config = await getSmtpConfig()
  if (!config.enabled) {
    return { ok: false, failure: 'disabled', detail: 'Outgoing email is switched off' }
  }
  const problems = smtpProblems(config)
  if (problems.length > 0) {
    return { ok: false, failure: 'notConfigured', detail: `Missing: ${problems.join(', ')}` }
  }
  return { config, sender: senderFor(config, await getAppName()) }
}

export async function sendEmail(message: OutgoingEmail): Promise<SmtpOutcome<SentEmail>> {
  const ready = await prepare()
  if ('ok' in ready) return ready
  return sendWithSmtp(ready.config, ready.sender, message)
}

/** One outcome per message, in order. See `sendManyWithSmtp` for how a batch stops. */
export async function sendEmails(messages: readonly OutgoingEmail[]): Promise<SmtpOutcome<SentEmail>[]> {
  if (messages.length === 0) return []
  const ready = await prepare()
  if ('ok' in ready) return messages.map(() => ready)
  return sendManyWithSmtp(ready.config, ready.sender, messages)
}

/** APP_BASE_URL, the fallback for links. Null if the environment cannot be read — it is only a fallback. */
function envBaseUrl(): string | null {
  try {
    return getEnv().APP_BASE_URL
  } catch {
    return null
  }
}

/** Where links in emails point, or null when no reachable address is known (see `links.ts`). */
export function emailLinkBaseFor(config: SmtpConfig): string | null {
  return emailLinkBase(config.publicUrl, envBaseUrl())
}

export interface EmailContext {
  locale: AppLocaleCode
  frame: EmailFrame
  /** Base for links back into the app (`appLink`), or null — then a message carries no links. */
  linkBase: string | null
}

/**
 * Everything a message needs besides its own content, for one recipient
 * language: pass the RECIPIENT's `resolveEffectiveUiLanguage(userId)`.
 */
export async function emailContext(config: SmtpConfig, localeCode: string | null | undefined): Promise<EmailContext> {
  const { code, rtl } = emailLocale(localeCode)
  const [appName, colors] = await Promise.all([getAppName(), getThemeColors()])
  const linkBase = emailLinkBaseFor(config)
  return { locale: code, linkBase, frame: { lang: code, rtl, appName, accent: colors.primary, homeUrl: linkBase } }
}

/** `emailContext` with the saved settings. */
export async function emailContextFor(localeCode: string | null | undefined): Promise<EmailContext> {
  return emailContext(await getSmtpConfig(), localeCode)
}

/**
 * The Test button's message, in the language of whoever asked for it: short,
 * and saying where it came from, so whoever receives it — not always the admin
 * who pressed the button — can tell it is a check and not something to act on.
 */
export async function buildTestEmail(
  config: SmtpConfig,
  localeCode: string | null | undefined,
  requestedBy: string
): Promise<RenderedEmail> {
  return (await renderTestEmail(config, localeCode, requestedBy)).rendered
}

/** `host:port`, with an IPv6 host bracketed so the port cannot read as part of the address. */
function serverLabel(config: SmtpConfig): string {
  return config.host.includes(':') ? `[${config.host}]:${config.port}` : `${config.host}:${config.port}`
}

async function renderTestEmail(
  config: SmtpConfig,
  localeCode: string | null | undefined,
  requestedBy: string
): Promise<{ rendered: RenderedEmail; appName: string }> {
  const context = await emailContext(config, localeCode)
  const appName = context.frame.appName
  const vars = { appName, server: serverLabel(config), admin: requestedBy }
  const text = (key: EmailStringKey) => emailText(context.locale, key, vars)
  const rendered = renderEmail(
    {
      subject: text('test.subject'),
      preheader: text('test.preheader'),
      heading: text('test.heading'),
      paragraphs: [text('test.sentThrough'), text('test.nothingToDo')],
      action: { label: text('action.openApp'), url: appLink(context.linkBase, '/') },
      footer: [text('footer.automated')],
    },
    context.frame
  )
  return { rendered, appName }
}

export async function sendTestEmail(
  config: SmtpConfig,
  to: string,
  requestedBy: string,
  localeCode: string | null | undefined
): Promise<SmtpOutcome<SentEmail>> {
  const { rendered, appName } = await renderTestEmail(config, localeCode, requestedBy)
  return sendWithSmtp(config, senderFor(config, appName), { to, ...rendered })
}
