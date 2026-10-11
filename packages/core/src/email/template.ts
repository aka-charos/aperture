/**
 * The email layout: structured content in, a subject, an HTML body and a
 * plain-text body out. Pure.
 *
 * Every email the app sends goes through `renderEmail`, which produces BOTH
 * bodies from the same content, so the plain-text version (what some clients
 * show, and what spam filters read) can never say something the HTML does not.
 *
 * Callers pass PLAIN TEXT everywhere — titles, names, translated strings — and
 * this module escapes all of it. No field accepts markup, which is what makes
 * a film titled `<script>` or a display name with an ampersand harmless.
 * Links are only ever http(s); anything else is dropped rather than linked.
 *
 * The HTML is what email clients actually render: nested tables, inline
 * styles, a 600px column, no external CSS, fonts or scripts. Outlook on
 * Windows draws with Word's engine, which ignores most of CSS, so anything
 * fancier than this degrades there first.
 */
import { isContentId } from './rules.js'

export interface EmailItem {
  title: string
  /** One short line under the title, e.g. "2019 · Drama". */
  meta?: string
  /** A sentence about the item, e.g. who recommended it and why. */
  note?: string
  /** Where the title links to; dropped unless http(s). */
  url?: string | null
  /** Content id of an image carried in the message (see `EmailImage`). */
  imageCid?: string
}

export interface EmailAction {
  label: string
  url: string | null
}

export interface EmailContent {
  subject: string
  /** The line inbox lists show beside the subject; hidden in the body. */
  preheader?: string
  heading: string
  paragraphs: string[]
  items?: EmailItem[]
  /** The one button. Omitted when it has no link, so a dead button is never drawn. */
  action?: EmailAction
  footer: string[]
}

export interface EmailFrame {
  /** The `lang` of the document — the recipient's language. */
  lang: string
  rtl: boolean
  appName: string
  /** The instance's primary colour, `#rrggbb`; anything else is the default. */
  accent: string
  /** Where the instance name at the top links to; plain text when null. */
  homeUrl: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const PAGE_BACKGROUND = '#f4f4f7'
const CARD_BACKGROUND = '#ffffff'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const RULE = '#e5e7eb'
const ITEM_IMAGE_WIDTH = 64
/**
 * Used only when the accent handed in is not a colour. The caller passes
 * `getThemeColors().primary`, which has its own default, so this is a guard
 * rather than a brand colour — and not a copy of that default to drift.
 */
const FALLBACK_ACCENT = '#374151'

/** Text for an HTML text node or a double-quoted attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** An absolute http(s) link, or null. Never `javascript:`, `data:`, or a relative path. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function accentOf(value: string): string {
  return HEX_COLOR.test(value) ? value.toLowerCase() : FALLBACK_ACCENT
}

/**
 * The label colour for a button on `hex`, so it stays legible whatever brand
 * colour the operator picked. The rule is the one MUI applies to the app's own
 * buttons (white whenever white reaches a 3:1 contrast ratio, its default
 * `contrastThreshold`), so the email's button looks like the app's — on the
 * default indigo that is white, where "whichever contrasts more" picks black
 * by a hair.
 */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  return contrastWithWhite >= 3 ? '#ffffff' : '#000000'
}

/** A single-line string: the subject and the preheader go where a line break would end a header. */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderItemHtml(item: EmailItem, align: string): string {
  const url = safeUrl(item.url)
  const title = escapeHtml(item.title)
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" style="color:${TEXT};text-decoration:none;font-weight:600;">${title}</a>`
    : `<span style="font-weight:600;">${title}</span>`
  const meta = item.meta
    ? `<div style="color:${MUTED};font-size:13px;line-height:18px;margin-top:2px;">${escapeHtml(item.meta)}</div>`
    : ''
  const note = item.note
    ? `<div style="font-size:14px;line-height:20px;margin-top:6px;">${escapeHtml(item.note)}</div>`
    : ''
  const image =
    item.imageCid && isContentId(item.imageCid)
      ? `<td width="${ITEM_IMAGE_WIDTH}" valign="top" style="padding:0;width:${ITEM_IMAGE_WIDTH}px;">` +
        `<img src="cid:${item.imageCid}" width="${ITEM_IMAGE_WIDTH}" alt="" style="display:block;width:${ITEM_IMAGE_WIDTH}px;height:auto;border:0;border-radius:4px;"></td>` +
        `<td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>`
      : ''
  return (
    `<tr><td style="padding:10px 0;border-bottom:1px solid ${RULE};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    image +
    `<td valign="top" align="${align}" style="font-family:${FONT};color:${TEXT};font-size:15px;line-height:21px;text-align:${align};">` +
    titleHtml +
    meta +
    note +
    `</td></tr></table></td></tr>`
  )
}

function renderHtml(content: EmailContent, frame: EmailFrame, subject: string): string {
  const accent = accentOf(frame.accent)
  const align = frame.rtl ? 'right' : 'left'
  const dir = frame.rtl ? 'rtl' : 'ltr'
  const homeUrl = safeUrl(frame.homeUrl)
  const appName = escapeHtml(frame.appName)
  const wordmark = homeUrl
    ? `<a href="${escapeHtml(homeUrl)}" style="color:${accent};text-decoration:none;">${appName}</a>`
    : `<span style="color:${accent};">${appName}</span>`
  const cell = (inner: string, padding: string) =>
    `<tr><td align="${align}" style="padding:${padding};font-family:${FONT};color:${TEXT};text-align:${align};">${inner}</td></tr>`

  const paragraphs = content.paragraphs
    .map((p) => cell(`<p style="margin:0;font-size:15px;line-height:23px;">${escapeHtml(p)}</p>`, '0 28px 14px'))
    .join('')

  const items = content.items?.length
    ? cell(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${RULE};">` +
          content.items.map((item) => renderItemHtml(item, align)).join('') +
          `</table>`,
        '4px 28px 18px'
      )
    : ''

  const actionUrl = safeUrl(content.action?.url)
  const action =
    content.action && actionUrl
      ? cell(
          `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:${accent};color:${readableOn(accent)};` +
            `font-size:15px;font-weight:600;line-height:20px;padding:12px 22px;border-radius:6px;text-decoration:none;">` +
            `${escapeHtml(content.action.label)}</a>`,
          '6px 28px 24px'
        )
      : ''

  const footer = content.footer.length
    ? `<tr><td align="${align}" style="padding:16px 28px 22px;border-top:1px solid ${RULE};font-family:${FONT};` +
      `color:${MUTED};font-size:12px;line-height:18px;text-align:${align};">` +
      content.footer.map((line) => `<div>${escapeHtml(line)}</div>`).join('') +
      `</td></tr>`
    : ''

  const preheader = content.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(oneLine(content.preheader))}</div>`
    : ''

  return (
    `<!DOCTYPE html>` +
    `<html lang="${escapeHtml(frame.lang)}" dir="${dir}">` +
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${PAGE_BACKGROUND};">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="background:${PAGE_BACKGROUND};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" ` +
    `style="max-width:600px;background:${CARD_BACKGROUND};border-radius:8px;border-top:4px solid ${accent};">` +
    cell(`<div style="font-size:16px;font-weight:700;line-height:22px;">${wordmark}</div>`, '22px 28px 4px') +
    cell(
      `<h1 style="margin:0;font-size:22px;line-height:29px;font-weight:700;">${escapeHtml(content.heading)}</h1>`,
      '10px 28px 16px'
    ) +
    paragraphs +
    items +
    action +
    footer +
    `</table></td></tr></table></body></html>`
  )
}

function renderText(content: EmailContent, frame: EmailFrame): string {
  const blocks: string[] = [frame.appName, content.heading, ...content.paragraphs]
  if (content.items?.length) {
    blocks.push(
      content.items
        .map((item) => {
          const lines = [`- ${item.title}${item.meta ? ` (${item.meta})` : ''}`]
          if (item.note) lines.push(`  ${item.note}`)
          const url = safeUrl(item.url)
          if (url) lines.push(`  ${url}`)
          return lines.join('\n')
        })
        .join('\n\n')
    )
  }
  const actionUrl = safeUrl(content.action?.url)
  if (content.action && actionUrl) blocks.push(`${content.action.label}: ${actionUrl}`)
  if (content.footer.length) blocks.push(`--\n${content.footer.join('\n')}`)
  return `${blocks.join('\n\n')}\n`
}

/** Both bodies from one piece of content. See the module comment for the escaping contract. */
export function renderEmail(content: EmailContent, frame: EmailFrame): RenderedEmail {
  const subject = oneLine(content.subject)
  return {
    subject,
    html: renderHtml(content, frame, subject),
    text: renderText(content, frame),
  }
}

/**
 * The HTML with each `cid:` image replaced by a `data:` URI, for a preview in a
 * browser, which cannot resolve a content id. Never sent: a message carries
 * its images as attachments, which is what keeps them displaying.
 */
export function inlineImagesForPreview(
  html: string,
  images: readonly { cid: string; content: Buffer; contentType: string }[]
): string {
  return images.reduce(
    (out, image) =>
      out.split(`cid:${image.cid}"`).join(`data:${image.contentType};base64,${image.content.toString('base64')}"`),
    html
  )
}
