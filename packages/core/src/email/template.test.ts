import { test } from 'node:test'
import assert from 'node:assert/strict'

import { escapeHtml, inlineImagesForPreview, readableOn, renderEmail, safeUrl, type EmailContent, type EmailFrame } from './template.js'

const frame: EmailFrame = {
  lang: 'en',
  rtl: false,
  appName: 'Home cinema',
  accent: '#6366f1',
  homeUrl: 'https://aperture.example.com',
}

const content: EmailContent = {
  subject: 'Something to watch',
  preheader: 'A friend recommended a film',
  heading: 'A recommendation from Alex',
  paragraphs: ['Alex thinks you would like this.', 'It is in your library now.'],
  items: [
    {
      title: 'Aniara',
      meta: '2018 · Science fiction',
      note: 'A ship drifts off course.',
      url: 'https://aperture.example.com/movies/1',
      imageCid: 'poster-1',
    },
  ],
  action: { label: 'Open Home cinema', url: 'https://aperture.example.com/watch-this' },
  footer: ['This email was sent automatically by Home cinema.'],
}

// ---------------------------------------------------------------- nothing passed in is markup

test('every field is escaped, so a title or a name cannot carry markup', () => {
  const hostile: EmailContent = {
    subject: 'Hi <b>there</b>',
    heading: '<script>alert(1)</script>',
    paragraphs: ['Tom & Jerry say "hi" <img src=x onerror=alert(1)>'],
    items: [{ title: '<i>Title</i>', meta: '"meta"', note: "it's <b>bold</b>" }],
    action: { label: '<b>Go</b>', url: 'https://example.com' },
    footer: ['<a href="https://evil.example">click</a>'],
  }
  const { html } = renderEmail(hostile, { ...frame, appName: 'A&B <Cinema>' })
  for (const raw of ['<script>', '<img src=x', '<i>Title</i>', '<b>bold</b>', '<b>Go</b>', '<a href="https://evil.example"']) {
    assert.ok(!html.includes(raw), `unescaped: ${raw}`)
  }
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('Tom &amp; Jerry say &quot;hi&quot;'))
  assert.ok(html.includes('A&amp;B &lt;Cinema&gt;'))
})

test('only http(s) links are drawn; anything else is dropped, never linked', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/movies/1', 'mailto:a@example.com', '', null, undefined]) {
    assert.equal(safeUrl(bad), null, String(bad))
  }
  assert.equal(safeUrl('https://example.com/a?b=c'), 'https://example.com/a?b=c')

  const { html, text } = renderEmail(
    { ...content, items: [{ title: 'Aniara', url: 'javascript:alert(1)' }], action: { label: 'Go', url: 'javascript:alert(1)' } },
    frame
  )
  assert.ok(!html.includes('javascript:'))
  assert.ok(!text.includes('javascript:'))
})

test('an action with no link is not drawn at all, rather than as a dead button', () => {
  const { html, text } = renderEmail({ ...content, action: { label: 'Open Home cinema', url: null } }, frame)
  assert.ok(!html.includes('Open Home cinema'))
  assert.ok(!text.includes('Open Home cinema'))
})

test('the subject and preheader are single lines', () => {
  const { subject, html } = renderEmail({ ...content, subject: 'Hello\r\nBcc: a@example.com', preheader: 'line\none' }, frame)
  assert.equal(subject, 'Hello Bcc: a@example.com')
  assert.ok(html.includes('line one'))
})

// ---------------------------------------------------------------- one content, two bodies

test('the plain text says everything the HTML does', () => {
  const { html, text } = renderEmail(content, frame)
  for (const part of [
    content.heading,
    ...content.paragraphs,
    'Aniara',
    '2018 · Science fiction',
    'A ship drifts off course.',
    'https://aperture.example.com/movies/1',
    'Open Home cinema',
    'https://aperture.example.com/watch-this',
    ...content.footer,
  ]) {
    assert.ok(text.includes(part), `text is missing: ${part}`)
    assert.ok(html.includes(escapeHtml(part)), `html is missing: ${part}`)
  }
})

test('the document declares its language and direction', () => {
  const ltr = renderEmail(content, frame).html
  assert.ok(ltr.includes('<html lang="en" dir="ltr">'))
  const rtl = renderEmail(content, { ...frame, lang: 'ar', rtl: true }).html
  assert.ok(rtl.includes('<html lang="ar" dir="rtl">'))
  assert.ok(rtl.includes('text-align:right'))
  assert.ok(!rtl.includes('text-align:left'))
})

test('the wordmark links home only when a home address is known', () => {
  assert.ok(renderEmail(content, frame).html.includes('href="https://aperture.example.com/"'))
  const unlinked = renderEmail({ ...content, action: undefined, items: [] }, { ...frame, homeUrl: null }).html
  assert.ok(!unlinked.includes('href='))
})

// ---------------------------------------------------------------- colour and images

test('a colour that is not a hex code is not written into the style', () => {
  const { html } = renderEmail(content, { ...frame, accent: 'red;background:url(https://evil.example)' })
  assert.ok(!html.includes('evil.example'))
})

test('the button label stays legible on any brand colour', () => {
  assert.equal(readableOn('#6366f1'), '#ffffff')
  assert.equal(readableOn('#111827'), '#ffffff')
  assert.equal(readableOn('#facc15'), '#000000')
  assert.equal(readableOn('#ffffff'), '#000000')
})

test('an image is referenced by content id, and an invalid id is left out', () => {
  assert.ok(renderEmail(content, frame).html.includes('src="cid:poster-1"'))
  const bad = renderEmail({ ...content, items: [{ title: 'X', imageCid: 'a"b onerror=x' }] }, frame).html
  assert.ok(!bad.includes('cid:'))
})

test('the preview swaps a content id for the image itself', () => {
  const { html } = renderEmail(content, frame)
  const shown = inlineImagesForPreview(html, [
    { cid: 'poster-1', content: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' },
  ])
  assert.ok(shown.includes('src="data:image/jpeg;base64,AQID"'))
  assert.ok(!shown.includes('cid:poster-1'))
})
