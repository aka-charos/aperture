import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeGuideLayout, TOC_MIN_SECTIONS } from './guideLayout'
import { docHeadings } from './markdown'

/**
 * The layout pass over the real pages and over each pattern it reads. It
 * restructures what every guide page renders, so the checks that matter are
 * that it loses nothing (no section, no link, no words) and that each shape
 * becomes what `DocMarkdown` draws.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../..')

function render(markdown: string, layout = true): string {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: layout ? [rehypeGuideLayout] : [] }, markdown)
  )
}

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full))
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

const PAGES = [
  ...markdownFiles(resolve(REPO, 'docs/features')),
  ...markdownFiles(resolve(REPO, 'docs/admin')),
  ...markdownFiles(resolve(REPO, 'docs/el/features')),
]

/** Words a reader sees, from rendered HTML; attribute values count, since the "Next" label rides in one. */
function words(html: string): Set<string> {
  const labels = [...html.matchAll(/data-label="([^"]*)"/g)].map((m) => m[1]).join(' ')
  const body = html.replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ')
  return new Set(`${body} ${labels}`.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
}

test('the real pages: one section per ## heading, nothing lost', () => {
  assert.ok(PAGES.length > 40, 'the pages were found')
  for (const file of PAGES) {
    const markdown = readFileSync(file, 'utf8')
    const html = render(markdown)
    const plain = render(markdown, false)
    const name = file.slice(REPO.length + 1)

    const h2 = docHeadings(markdown).filter((h) => h.depth === 2).length
    const sections = html.match(/<section data-doc="section">/g)?.length ?? 0
    assert.equal(sections, h2, `${name}: one card per section`)
    assert.equal(html.includes('data-doc="toc"'), h2 >= TOC_MIN_SECTIONS, `${name}: contents strip`)

    const links = (s: string) => s.match(/<a /g)?.length ?? 0
    assert.equal(links(html), links(plain), `${name}: every link kept`)

    // A two-column table's header row is the one thing dropped on purpose.
    const headers = new Set(
      [...plain.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].flatMap((m) =>
        m[1].replace(/<[^>]+>/g, ' ').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
      )
    )
    const kept = words(html)
    const lost = [...words(plain)].filter((w) => !kept.has(w) && !headers.has(w))
    assert.deepEqual(lost, [], `${name}: no words lost`)
  }
})

test('the first paragraph under the title is the lede', () => {
  const html = render('# Page\n\nOpening words.\n\nMore words.\n\n## A\n\nText.')
  assert.match(html, /<p data-doc="lede">Opening words\.<\/p>/)
  assert.equal(html.match(/data-doc="lede"/g)?.length, 1)
  // A notice above the opening is not a lede, and nothing after it becomes one.
  assert.doesNotMatch(render('# Page\n\n> **Legacy.** Old.\n\nOpening.'), /data-doc="lede"/)
})

test('sections are numbered cards; the contents strip needs three', () => {
  const two = render('# P\n\n## One\n\nA\n\n---\n\n## Two\n\nB')
  assert.match(two, /<section data-doc="section"><h2 data-index="1">One<\/h2>/)
  assert.match(two, /<section data-doc="section"><h2 data-index="2">Two<\/h2>/)
  assert.doesNotMatch(two, /<hr/, 'a rule between sections is dropped')
  assert.doesNotMatch(two, /data-doc="toc"/)
  assert.match(render('# P\n\n## A\n\n## B\n\n## C'), /<nav data-doc="toc"><\/nav><section/)
})

test('a two-column table becomes a term list; a wider one stays a table', () => {
  const terms = render('| Stat | Description |\n|---|---|\n| **Ratings** | Titles you rated |\n| Time | Viewing time |')
  assert.match(terms, /<dl data-doc="terms"><dt><strong>Ratings<\/strong><\/dt><dd>Titles you rated<\/dd><dt>Time<\/dt><dd>Viewing time<\/dd><\/dl>/)
  assert.doesNotMatch(terms, /Stat|<table/)
  assert.match(render('| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |'), /<table>/)
})

test('a bold term with a dash or colon splits from its description', () => {
  const html = render('- **Rank badges** — numbered, matching [the list](x.md)\n- **Rate it:** hover\n- **Click any poster** to open it\n- Plain item')
  assert.match(html, /<ul data-doc="features">/)
  assert.match(html, /<li data-doc="feature"><span data-doc="term">Rank badges<\/span><span data-doc="desc">numbered, matching <a href="x.md">the list<\/a><\/span><\/li>/)
  assert.match(html, /<span data-doc="term">Rate it<\/span><span data-doc="desc">hover<\/span>/)
  // No separator: the bold is part of the sentence and stays in it.
  assert.match(html, /<li data-doc="feature"><strong>Click any poster<\/strong> to open it<\/li>/)
  assert.match(html, /<li data-doc="feature">Plain item<\/li>/)
  // Nested and numbered lists are left alone.
  const nested = render('- Outer\n  - Inner\n\n1. Step')
  assert.equal(nested.match(/data-doc="features"/g)?.length, 1)
  assert.match(nested, /<ol>/)
})

test('quoted words are what the screen says, outside code, links and headings', () => {
  const html = render('Shows "Airing", “2d ago” and «Επόμενο»; not `"code"` or [a "link"](x.md).\n\n## A "heading"')
  assert.match(html, /<span data-doc="ui">Airing<\/span>/)
  assert.match(html, /<span data-doc="ui">2d ago<\/span>/)
  assert.match(html, /<span data-doc="ui">Επόμενο<\/span>/)
  assert.match(html, /<code>&quot;code&quot;<\/code>/)
  assert.match(html, /<a href="x.md">a &quot;link&quot;<\/a>/)
  assert.match(html, /<h2 data-index="1">A &quot;heading&quot;<\/h2>/)
  // A long quotation is a sentence, not a label.
  assert.doesNotMatch(render(`It says "${'word '.repeat(12).trim()}".`), /data-doc="ui"/)
})

test('a short capitalised bold run is a screen label; emphasis and item names stay bold', () => {
  const html = render(
    'Links **More details**, shows **Airing** and **«Επόμενο»**, over the **last 30 days**. **Note:** a lead-in. ' +
      '**This is a whole sentence that runs well past six words**.'
  )
  assert.match(html, /<span data-doc="ui">More details<\/span>/)
  assert.match(html, /<span data-doc="ui">Airing<\/span>/)
  assert.match(html, /<span data-doc="ui">Επόμενο<\/span>/, 'quotes inside the bold are dropped')
  assert.match(html, /<strong>last 30 days<\/strong>/)
  assert.match(html, /<strong>Note:<\/strong>/)
  assert.match(html, /<strong>This is a whole sentence that runs well past six words<\/strong>/)

  // Bold that opens a list item, a cell or a term names the item.
  const items = render('- **Click any poster** to open **Insights**\n\n| A | B | C |\n|---|---|---|\n| **Movies** | **Today** | x |')
  assert.match(items, /<strong>Click any poster<\/strong> to open <span data-doc="ui">Insights<\/span>/)
  assert.match(items, /<td><strong>Movies<\/strong><\/td><td><strong>Today<\/strong><\/td>/)
  const loose = render('- **Rate it** in place\n\n- **Skip it** with **Esc**')
  assert.match(loose, /<p><strong>Rate it<\/strong> in place<\/p>/)
  assert.match(loose, /<strong>Skip it<\/strong> with <span data-doc="ui">Esc<\/span>/)
  // A label inside a split description is a label.
  assert.match(render('- **Rank badges** — tap **Open**'), /<span data-doc="desc">tap <span data-doc="ui">Open<\/span><\/span>/)
  // Headings keep their bold.
  assert.match(render('## The **Next** step'), /<strong>Next<\/strong>/)
})

test('blockquotes: alerts and bold openings are callouts, a quoted line is an example', () => {
  const tip = render('> [!TIP]\n> Rate five titles.')
  assert.match(tip, /<blockquote data-doc="callout" data-tone="tip">/)
  assert.doesNotMatch(tip, /\[!TIP\]/)
  assert.match(tip, /Rate five titles\./)
  assert.match(render('> [!NOTE]\n> Noted.'), /data-tone="info"/)
  assert.match(render('> [!WARNING]\n> Deletes it.'), /data-tone="warning"/)
  // A bold opening is a notice, and its bold stays bold.
  const notice = render('> **This is a legacy feature.** Being phased out.')
  assert.match(notice, /<blockquote data-doc="callout" data-tone="warning">/)
  assert.match(notice, /<strong>This is a legacy feature\.<\/strong>/)
  assert.match(render('> "What should I watch tonight?"'), /<blockquote data-doc="example">\s*<p>What should I watch tonight\?<\/p>/)
  assert.match(render('> «Τι να δω απόψε;»'), /data-doc="example"/)
  assert.doesNotMatch(render('> *Status: Searching…*'), /data-doc=/)
})

test('a closing "Next" link becomes the next-page card', () => {
  const html = render('# P\n\n## A\n\nText.\n\n---\n\n**Next:** [Global Search](global-search.md)')
  assert.match(html, /<\/section><div data-doc="next" data-label="Next"><a href="global-search.md">Global Search<\/a><\/div>$/)
  assert.match(render('**Επόμενο:** [Αναζήτηση](global-search.md)'), /data-label="Επόμενο"/)
  // Bold followed by more than a link is a sentence.
  assert.doesNotMatch(render('**Next:** see [Search](s.md) too'), /data-doc="next"/)
})
