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

/**
 * A piece of formatted text: plain text plus the styling it carries. Never
 * markup — the renderer escapes `text` and builds the tags itself, so rich
 * text written in an editor reaches an email under the same contract as
 * every other field. A line break inside a run is kept as a line break.
 */
export interface EmailRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Dropped unless http(s), like every link here. */
  href?: string | null
}

/** One labelled fact on a title card, e.g. "Languages: English, French". */
export interface EmailFact {
  label: string
  value: string
}

/** A titled passage on a title card, e.g. the plot or an analysis. */
export interface EmailPassage {
  label?: string
  /** Paragraphs, in order. */
  paragraphs: string[]
}

/**
 * Body blocks, rendered between the paragraphs and the items. This is the
 * shape a newsletter's editor document is read into (core newsletter/
 * document.ts); a notification that only needs sentences keeps using
 * `paragraphs`.
 */
export type EmailBlock =
  | { type: 'paragraph'; runs: EmailRun[] }
  | { type: 'heading'; level: 2 | 3; runs: EmailRun[] }
  | { type: 'list'; ordered: boolean; items: EmailRun[][] }
  | { type: 'quote'; runs: EmailRun[] }
  | { type: 'rule' }
  | {
      type: 'title'
      title: string
      meta?: string
      url?: string | null
      imageCid?: string
      facts: EmailFact[]
      passages: EmailPassage[]
      /** A text link under the card, e.g. "Open in Aperture". */
      linkLabel?: string
    }

export interface EmailContent {
  subject: string
  /** The line inbox lists show beside the subject; hidden in the body. */
  preheader?: string
  heading: string
  paragraphs: string[]
  /** Formatted body, after the paragraphs. See `EmailBlock`. */
  blocks?: EmailBlock[]
  items?: EmailItem[]
  /** The one button. Omitted when it has no link, so a dead button is never drawn. */
  action?: EmailAction
  footer: string[]
  /** A small link under the footer lines, e.g. Unsubscribe. Omitted without a link. */
  footerLink?: EmailAction
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
const TITLE_IMAGE_WIDTH = 120
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

/** Escaped text with its line breaks kept. */
function escapeLines(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function renderRunsHtml(runs: readonly EmailRun[], accent: string): string {
  return runs
    .map((run) => {
      let html = escapeLines(run.text)
      if (run.bold) html = `<strong>${html}</strong>`
      if (run.italic) html = `<em>${html}</em>`
      if (run.underline) html = `<u>${html}</u>`
      if (run.strike) html = `<s>${html}</s>`
      const href = safeUrl(run.href)
      if (href) html = `<a href="${escapeHtml(href)}" style="color:${accent};text-decoration:underline;">${html}</a>`
      return html
    })
    .join('')
}

function runsText(runs: readonly EmailRun[]): string {
  return runs
    .map((run) => {
      const href = safeUrl(run.href)
      return href && href !== run.text ? `${run.text} (${href})` : run.text
    })
    .join('')
}

function renderTitleHtml(block: Extract<EmailBlock, { type: 'title' }>, align: string, accent: string): string {
  const url = safeUrl(block.url)
  const title = escapeHtml(block.title)
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" style="color:${TEXT};text-decoration:none;">${title}</a>`
    : title
  const meta = block.meta
    ? `<div style="color:${MUTED};font-size:13px;line-height:18px;margin-top:2px;">${escapeHtml(block.meta)}</div>`
    : ''
  const facts = block.facts
    .map(
      (fact) =>
        `<div style="font-size:13px;line-height:19px;margin-top:4px;"><span style="color:${MUTED};">${escapeHtml(fact.label)}:</span> ${escapeHtml(fact.value)}</div>`
    )
    .join('')
  const passages = block.passages
    .map((passage) => {
      const label = passage.label
        ? `<div style="font-size:12px;line-height:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${MUTED};margin-top:12px;">${escapeHtml(passage.label)}</div>`
        : ''
      const paragraphs = passage.paragraphs
        .map((p) => `<p style="margin:6px 0 0;font-size:14px;line-height:21px;">${escapeLines(p)}</p>`)
        .join('')
      return label + paragraphs
    })
    .join('')
  const link =
    url && block.linkLabel
      ? `<div style="margin-top:10px;font-size:14px;"><a href="${escapeHtml(url)}" style="color:${accent};text-decoration:underline;">${escapeHtml(block.linkLabel)}</a></div>`
      : ''
  const image =
    block.imageCid && isContentId(block.imageCid)
      ? `<td width="${TITLE_IMAGE_WIDTH}" valign="top" style="padding:0;width:${TITLE_IMAGE_WIDTH}px;">` +
        `<img src="cid:${block.imageCid}" width="${TITLE_IMAGE_WIDTH}" alt="${title}" style="display:block;width:${TITLE_IMAGE_WIDTH}px;height:auto;border:0;border-radius:6px;"></td>` +
        `<td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>`
      : ''
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border:1px solid ${RULE};border-radius:8px;"><tr><td style="padding:14px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    image +
    `<td valign="top" align="${align}" style="font-family:${FONT};color:${TEXT};text-align:${align};">` +
    `<div style="font-size:17px;line-height:23px;font-weight:700;">${titleHtml}</div>` +
    meta +
    facts +
    passages +
    link +
    `</td></tr></table></td></tr></table>`
  )
}

function renderBlockHtml(block: EmailBlock, align: string, accent: string): string {
  switch (block.type) {
    case 'paragraph':
      return `<p style="margin:0;font-size:15px;line-height:23px;">${renderRunsHtml(block.runs, accent)}</p>`
    case 'heading':
      return block.level === 2
        ? `<h2 style="margin:6px 0 0;font-size:19px;line-height:25px;font-weight:700;">${renderRunsHtml(block.runs, accent)}</h2>`
        : `<h3 style="margin:4px 0 0;font-size:16px;line-height:22px;font-weight:700;">${renderRunsHtml(block.runs, accent)}</h3>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const side = align === 'right' ? 'right' : 'left'
      return (
        `<${tag} style="margin:0;padding-${side}:22px;font-size:15px;line-height:23px;">` +
        block.items.map((item) => `<li style="margin:0 0 4px;">${renderRunsHtml(item, accent)}</li>`).join('') +
        `</${tag}>`
      )
    }
    case 'quote': {
      const side = align === 'right' ? 'right' : 'left'
      return (
        `<div style="border-${side}:3px solid ${RULE};padding-${side}:14px;color:${MUTED};font-size:15px;line-height:23px;font-style:italic;">` +
        `${renderRunsHtml(block.runs, accent)}</div>`
      )
    }
    case 'rule':
      return `<div style="border-top:1px solid ${RULE};font-size:0;line-height:0;">&nbsp;</div>`
    case 'title':
      return renderTitleHtml(block, align, accent)
  }
}

function renderBlockText(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return runsText(block.runs)
    case 'heading':
      return runsText(block.runs).toUpperCase()
    case 'list':
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${runsText(item)}`).join('\n')
    case 'quote':
      return runsText(block.runs)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'rule':
      return '----'
    case 'title': {
      const lines = [`== ${block.title}${block.meta ? ` (${block.meta})` : ''} ==`]
      for (const fact of block.facts) lines.push(`${fact.label}: ${fact.value}`)
      for (const passage of block.passages) {
        if (passage.label) lines.push('', passage.label)
        lines.push(...passage.paragraphs)
      }
      const url = safeUrl(block.url)
      if (url) lines.push('', `${block.linkLabel ?? block.title}: ${url}`)
      return lines.join('\n')
    }
  }
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

  const blocks = (content.blocks ?? [])
    .map((block) => cell(renderBlockHtml(block, align, accent), '0 28px 16px'))
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

  const footerLinkUrl = safeUrl(content.footerLink?.url)
  const footerLink =
    content.footerLink && footerLinkUrl
      ? `<div style="margin-top:6px;"><a href="${escapeHtml(footerLinkUrl)}" style="color:${MUTED};text-decoration:underline;">` +
        `${escapeHtml(content.footerLink.label)}</a></div>`
      : ''
  const footer =
    content.footer.length || footerLink
      ? `<tr><td align="${align}" style="padding:16px 28px 22px;border-top:1px solid ${RULE};font-family:${FONT};` +
        `color:${MUTED};font-size:12px;line-height:18px;text-align:${align};">` +
        content.footer.map((line) => `<div>${escapeHtml(line)}</div>`).join('') +
        footerLink +
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
    blocks +
    items +
    action +
    footer +
    `</table></td></tr></table></body></html>`
  )
}

function renderText(content: EmailContent, frame: EmailFrame): string {
  const blocks: string[] = [frame.appName, content.heading, ...content.paragraphs]
  for (const block of content.blocks ?? []) blocks.push(renderBlockText(block))
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
  const footerLinkUrl = safeUrl(content.footerLink?.url)
  const footerLines = [...content.footer]
  if (content.footerLink && footerLinkUrl) footerLines.push(`${content.footerLink.label}: ${footerLinkUrl}`)
  if (footerLines.length) blocks.push(`--\n${footerLines.join('\n')}`)
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
