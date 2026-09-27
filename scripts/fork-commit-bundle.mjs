#!/usr/bin/env node
/**
 * Bundle the fork's commits into evidence files for commit classification, and
 * assemble the finished verdicts into the fork-divergence document.
 *
 * WHY THIS EXISTS. This fork carries ~500 commits upstream does not have, and
 * the question "which of these are fixes and patches versus new features and
 * enhancements" is answerable only per commit, from evidence: what the commit
 * says it did and why, what it changed, whether the files it touched existed
 * upstream or were created on this side, and what the diff actually did. This
 * script gathers that evidence into small batch files a person or an agent can
 * read one after another. It deliberately does NOT classify: apart from a few
 * purely mechanical suggestions (subject prefixes, docs-only diffs, probe
 * scripts) the judgment is made by whoever reads the bundle.
 *
 * THE COMMIT MESSAGE IS THE BEST EVIDENCE, and the first version left it out.
 * This repository writes long commit bodies (median ~1,460 characters) that
 * state the failure a change repairs. Without them a reader sees only a capped
 * diff, and a repair delivered by ADDING code (a normalisation, a credential
 * lookup, a guard) reads as an enhancement: a blind re-classification of 16
 * commits from their messages disagreed with the diff-only verdict on four
 * commits whose message named a failure a user could hit. Bodies are included
 * now, and `--diff-cap 0` produces message-only bundles roughly a tenth the
 * size, with `git show <hash>` left for the cases a message leaves ambiguous.
 *
 * Provenance is the load-bearing fact. A path is marked `upstream` when it
 * exists at the upstream tip and `new` when it does not — which separates
 * "editing upstream's code" from "iterating on code this fork created", the
 * distinction most classifications turn on. Provenance comes from one
 * cumulative `git diff <base>..<head>`; paths absent from that diff (touched
 * and reverted, or created and deleted on this side) fall back to an existence
 * check at the base. The base is `--base`, NOT the range start: bundling only a
 * new tail (`--range <last-bundled>..dev`) must still measure provenance
 * against upstream, or every file the fork created reads as upstream's.
 *
 * Wiring files are counted apart. Barrel `index.ts` files, the locale JSON,
 * package.json and the lockfile are touched by almost every commit, so counting
 * them made 167 of the first 180 commits read as "touches upstream code" and
 * the flag said nothing. They are still listed, marked `wiring`, but excluded
 * from the upstream/new tally, and the locale and lockfile hunks are kept out
 * of the capped diff so its lines go to code.
 *
 * Read-only against git: every git invocation is a read. Bundles go to the
 * gitignored scratch dir (.zcode/); `--assemble` writes the two docs files.
 *
 * Usage:
 *   node scripts/fork-commit-bundle.mjs                    bundle: messages + capped diffs
 *   node scripts/fork-commit-bundle.mjs --diff-cap 0       bundle: messages only
 *   node scripts/fork-commit-bundle.mjs --assemble         verdicts -> docs/fork-divergence.{md,tsv}
 *
 * Options:
 *   --range <base>..<head>  commits to bundle              (default upstream/dev..dev)
 *   --base <ref>            provenance base                (default: the range's base)
 *   --out <dir>             scratch dir                    (default .zcode/fork-classify)
 *   --batch-size <n>        commits per batch file         (default 60)
 *   --diff-cap <n>          diff lines per commit, 0=none  (default 120)
 *   --body-cap <n>          message chars per commit, 0=all (default 3000)
 *   --doc-out <prefix>      assemble output path prefix    (default docs/fork-divergence)
 *
 * Verdicts are read from two places by --assemble: the committed
 * `<doc-out>.tsv` first, which is the durable record, then any
 * `<out>/verdicts-NN.tsv` scratch files, which override it. Extending the
 * record after new commits land therefore needs verdicts for the new tail
 * only. Scratch files are tab-separated with a header row:
 *   hash  category  flags  rationale  also_fixes
 * `also_fixes` is optional: an upstream defect repaired inside a commit whose
 * main category is something else, so a feature commit carrying a fix still
 * shows up under Fixed.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// Taxonomy — one copy, written into every batch header and the assembled doc
// ---------------------------------------------------------------------------

const CATEGORIES = [
  [
    'feature',
    'Added',
    'A capability upstream had no form of: a new subsystem, page, integration, role or setting area.',
  ],
  [
    'enhancement',
    'Enhanced',
    'Makes something that already existed work better, show more, or become configurable. Nothing was broken.',
  ],
  [
    'fix-upstream',
    'Fixed (upstream code)',
    'Repairs behaviour a user could hit in code inherited from upstream — a fix even when the repair adds code.',
  ],
  [
    'fix-own',
    'Fixed (fork code)',
    'Repairs something this fork introduced. Divergence upstream will never need.',
  ],
  [
    'chore-docs',
    'Docs & chores',
    'Documentation, locale syncs, tests-only, tooling and build changes; no product behaviour changes.',
  ],
  [
    'experiment',
    'Experiments',
    'Probes, benches and measurement scripts that change no product behaviour.',
  ],
]
const CATEGORY_IDS = CATEGORIES.map(([id]) => id)
const FLAGS =
  'upstream (edits upstream code, wiring excluded) · fork-only · refactor-upstream · fixes-own · mixed · data-only · continuation · migration · i18n'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    range: 'upstream/dev..dev',
    base: null,
    outDir: '.zcode/fork-classify',
    batchSize: 60,
    diffCap: 120,
    bodyCap: 3000,
    docOut: 'docs/fork-divergence',
    assemble: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--assemble') {
      out.assemble = true
      continue
    }
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const val = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (key === '--range') out.range = val
    else if (key === '--base') out.base = val
    else if (key === '--out') out.outDir = val
    else if (key === '--batch-size') out.batchSize = parseInt(val, 10)
    else if (key === '--diff-cap') out.diffCap = parseInt(val, 10)
    else if (key === '--body-cap') out.bodyCap = parseInt(val, 10)
    else if (key === '--doc-out') out.docOut = val
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!out.range.includes('..'))
    throw new Error(`--range must look like <base>..<head>, got: ${out.range}`)
  if (!(out.batchSize > 0)) throw new Error('--batch-size must be a positive integer')
  if (!(out.diffCap >= 0)) throw new Error('--diff-cap must be 0 or a positive integer')
  if (!(out.bodyCap >= 0)) throw new Error('--body-cap must be 0 or a positive integer')
  return out
}

const opts = parseArgs(process.argv)

// ---------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------

const git = (args, quiet = false) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    // The existence probe below expects "not found" as a normal outcome; keep
    // git's complaint off the console for it.
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
  })

const rangeBase = opts.range.split('..')[0]
const headRef = opts.range.split('..').slice(1).join('..') || 'HEAD'
const baseRef = opts.base ?? rangeBase
const baseTip = git(['rev-parse', baseRef]).trim()
const headTip = git(['rev-parse', headRef]).trim()

const tsvEscape = (s) => s.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n')
const tsvUnescape = (s) =>
  s.replace(/\\(\\|t|n)/g, (_, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : '\\'))

if (opts.assemble) {
  assemble()
} else {
  bundle()
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

function bundle() {
  // Commits oldest-first, with numstat folded into one pass.
  // Header lines carry \x01..\x1f control markers; numstat lines follow until the next header.
  const LOG_UNIT = '\x01'
  const LOG_SEP = '\x1f'
  const logRaw = git([
    'log',
    '--reverse',
    '--no-merges',
    `--format=${LOG_UNIT}%H${LOG_SEP}%ad${LOG_SEP}%s`,
    '--date=short',
    '--numstat',
    opts.range,
  ])

  const commits = []
  for (const line of logRaw.split('\n')) {
    if (line.startsWith(LOG_UNIT)) {
      const [hash, date, subject] = line.slice(1).split(LOG_SEP)
      commits.push({ hash, date, subject, files: [] })
    } else if (line.trim() && commits.length) {
      const [adds, dels, ...rest] = line.split('\t')
      commits[commits.length - 1].files.push({
        path: rest.join('\t').replace(/^"|"$/g, ''),
        adds: adds === '-' ? null : parseInt(adds, 10),
        dels: dels === '-' ? null : parseInt(dels, 10),
      })
    }
  }

  // Bodies in one pass, record-separated. A body is multi-line, so it cannot
  // ride in the numstat pass above without an ambiguous parse.
  const REC = '\x1e'
  const bodyRaw = git(['log', '--no-merges', `--format=%H${LOG_SEP}%b${REC}`, opts.range])
  const bodies = new Map()
  for (const rec of bodyRaw.split(REC)) {
    const sep = rec.indexOf(LOG_SEP)
    if (sep === -1) continue
    bodies.set(rec.slice(0, sep).trim(), cleanBody(rec.slice(sep + 1)))
  }

  // Status (A/M/D/R) per file, per commit. numstat alone cannot tell a new file
  // from a rewritten one.
  for (const c of commits) {
    const raw = git(['diff-tree', '--no-commit-id', '--name-status', '-r', c.hash])
    const byPath = new Map()
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const parts = line.split('\t')
      const status = parts[0]
      if (status.startsWith('R') || status.startsWith('C')) {
        byPath.set(parts[2], { status, adds: null, dels: null })
        byPath.set(parts[1], {
          status: status.startsWith('R') ? 'R-old' : 'C-old',
          adds: null,
          dels: null,
        })
      } else {
        byPath.set(parts[1], { status, adds: null, dels: null })
      }
    }
    // Merge numstat counts in (rename entries keep null counts).
    for (const f of c.files) {
      const hit = byPath.get(f.path)
      if (hit && hit.adds === null && hit.dels === null) {
        hit.adds = f.adds
        hit.dels = f.dels
      }
    }
    c.statusFiles = [...byPath.entries()].map(([path, s]) => ({ path, ...s }))
    c.body = bodies.get(c.hash) ?? ''
  }

  // Provenance: does each touched path exist at the upstream tip?
  const provRaw = git(['diff', '--name-status', baseTip, headTip])
  const cumulative = new Map()
  for (const line of provRaw.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    cumulative.set(parts[parts.length - 1], parts[0])
    if (parts.length === 3) cumulative.set(parts[1], parts[0]) // rename/copy source
  }

  const existsAtTip = (path) => {
    try {
      git(['cat-file', '-e', `${baseTip}:${path}`], true)
      return true
    } catch {
      return false
    }
  }

  const provenance = (path) => {
    const st = cumulative.get(path)
    if (st === 'A') return 'new'
    if (st) return 'upstream' // M/D/R against the tip: the path existed upstream
    // Not in the cumulative diff: either an upstream file the fork touched and
    // reverted, or a file created and deleted entirely on this side.
    return existsAtTip(path) ? 'upstream' : 'new'
  }

  mkdirSync(opts.outDir, { recursive: true })
  const batches = Math.ceil(commits.length / opts.batchSize)

  // commits.tsv — the index every batch file and the assembled TSV join against.
  const indexLines = [
    'hash\tdate\tsubject\tbatch\tnum\tfiles\tadds\tdels\tupstream\tnew\twiring\tauto',
  ]
  commits.forEach((c, i) => {
    const t = tally(c, provenance)
    indexLines.push(
      [
        c.hash,
        c.date,
        tsvEscape(c.subject),
        String(Math.floor(i / opts.batchSize) + 1),
        String(i + 1),
        String(c.statusFiles.length),
        String(t.adds),
        String(t.dels),
        String(t.upstream),
        String(t.fresh),
        String(t.wiring),
        autoLabel(c),
      ].join('\t')
    )
  })
  writeFileSync(join(opts.outDir, 'commits.tsv'), indexLines.join('\n') + '\n')
  writeFileSync(
    join(opts.outDir, 'range.json'),
    JSON.stringify(
      {
        range: opts.range,
        base: baseRef,
        baseTip,
        headRef,
        headTip,
        bundledAt: new Date().toISOString(),
        commits: commits.length,
      },
      null,
      2
    ) + '\n'
  )

  for (let b = 0; b < batches; b++) {
    const slice = commits.slice(b * opts.batchSize, (b + 1) * opts.batchSize)
    const nn = String(b + 1).padStart(2, '0')
    const parts = []
    parts.push(
      `# Batch ${nn} — commits ${b * opts.batchSize + 1}–${b * opts.batchSize + slice.length} of ${commits.length}`
    )
    parts.push(
      `<!-- range: ${opts.range}   provenance base: ${baseRef} @ ${baseTip.slice(0, 12)}   head: ${headTip.slice(0, 12)} -->`
    )
    parts.push('<!-- Categories:')
    for (const [id, , def] of CATEGORIES) parts.push(`       ${id.padEnd(12)} ${def}`)
    parts.push('-->')
    parts.push(`<!-- Flags: ${FLAGS} -->`)
    parts.push(
      `<!-- Verdicts go to verdicts-${nn}.tsv: hash\\tcategory\\tflags\\trationale\\talso_fixes -->`
    )
    parts.push('')

    slice.forEach((c, j) => {
      const num = b * opts.batchSize + j + 1
      const t = tally(c, provenance)
      parts.push(
        `## ${String(num).padStart(3, '0')} · ${c.hash.slice(0, 8)} · ${c.date} · ${c.subject}`
      )
      parts.push(
        `auto: ${autoLabel(c)} | files: ${c.statusFiles.length} (+${t.adds}/−${t.dels}) | upstream: ${t.upstream} · new: ${t.fresh} · wiring: ${t.wiring}`
      )
      if (c.body) {
        const body =
          opts.bodyCap > 0 && c.body.length > opts.bodyCap
            ? `${c.body.slice(0, opts.bodyCap)}\n… [${c.body.length - opts.bodyCap} more message chars]`
            : c.body
        parts.push('', ...body.split('\n').map((l) => `> ${l}`), '')
      }
      for (const f of c.statusFiles) {
        const counts =
          f.adds === null
            ? ''
            : ` (${f.adds === 0 && f.dels === 0 ? 'bin' : `+${f.adds}/−${f.dels}`})`
        const tag = isWiring(f.path) ? `${provenance(f.path)}, wiring` : provenance(f.path)
        parts.push(`- ${f.status} ${f.path}${counts} [${tag}]`)
      }
      if (opts.diffCap > 0) {
        const patch = git([
          'show',
          '--format=',
          '--patch',
          c.hash,
          '--',
          '.',
          ':(exclude,glob)**/i18n/locales/**',
          ':(exclude)pnpm-lock.yaml',
        ])
        const lines = patch.split('\n')
        parts.push('```diff')
        if (lines.length > opts.diffCap) {
          parts.push(...lines.slice(0, opts.diffCap))
          parts.push(`... [${lines.length - opts.diffCap} more diff lines truncated]`)
        } else {
          parts.push(...lines)
        }
        parts.push('```')
      }
      parts.push('')
    })

    writeFileSync(join(opts.outDir, `batch-${nn}.md`), parts.join('\n') + '\n')
  }

  console.log(`range:        ${opts.range}`)
  console.log(`provenance:   ${baseTip} (${baseRef})`)
  console.log(`head tip:     ${headTip} (${headRef})`)
  console.log(`commits:      ${commits.length} (non-merge, oldest first)`)
  console.log(
    `batches:      ${batches} × ≤${opts.batchSize}, diff cap ${opts.diffCap || 'none'}, body cap ${opts.bodyCap || 'none'}`
  )
  console.log(`output:       ${opts.outDir}/commits.tsv + batch-*.md`)
}

/** Drop trailers that carry no evidence (co-author lines, sign-offs). */
function cleanBody(raw) {
  return raw
    .split('\n')
    .filter((l) => !/^(Co-Authored-By|Signed-off-by):/i.test(l.trim()))
    .join('\n')
    .trim()
}

/**
 * Files nearly every commit touches for plumbing rather than substance. Listed,
 * but kept out of the upstream/new tally so that tally says something.
 */
function isWiring(path) {
  return (
    /(^|\/)index\.tsx?$/.test(path) ||
    path.includes('/i18n/locales/') ||
    /(^|\/)pnpm-lock\.yaml$/.test(path) ||
    /(^|\/)package\.json$/.test(path)
  )
}

function tally(c, provenance) {
  let upstream = 0
  let fresh = 0
  let wiring = 0
  let adds = 0
  let dels = 0
  for (const f of c.statusFiles) {
    adds += f.adds ?? 0
    dels += f.dels ?? 0
    if (isWiring(f.path)) wiring++
    else if (provenance(f.path) === 'upstream') upstream++
    else fresh++
  }
  return { upstream, fresh, wiring, adds, dels }
}

function autoLabel(c) {
  const prefix = c.subject.match(/^(docs|chore|build|ci|test):\s/i)
  if (prefix) return `prefix:${prefix[1].toLowerCase()}`
  if (c.statusFiles.length && c.statusFiles.every((f) => f.path.startsWith('docs/')))
    return 'docs-only'
  if (c.statusFiles.length && c.statusFiles.every((f) => f.path.startsWith('scripts/')))
    return 'scripts-only'
  if (c.statusFiles.length && c.statusFiles.every((f) => f.path.includes('/i18n/locales/')))
    return 'locales-only'
  return '-'
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

function assemble() {
  const indexPath = join(opts.outDir, 'commits.tsv')
  if (!existsSync(indexPath)) throw new Error(`${indexPath} not found — run the bundle step first`)
  const [header, ...rows] = readFileSync(indexPath, 'utf8').trimEnd().split('\n')
  const cols = header.split('\t')
  const col = (name) => cols.indexOf(name)
  const commits = rows.map((r) => {
    const f = r.split('\t')
    return { hash: f[col('hash')], date: f[col('date')], subject: tsvUnescape(f[col('subject')]) }
  })
  const range = existsSync(join(opts.outDir, 'range.json'))
    ? JSON.parse(readFileSync(join(opts.outDir, 'range.json'), 'utf8'))
    : null

  // Verdicts. The committed `<doc-out>.tsv` is the durable record, so it is
  // read first as the base: the scratch dir is gitignored, and a record that
  // could only be extended from one machine's scratch would be lost with it.
  // Then every verdicts-NN.tsv in the scratch dir, which override the base —
  // that is how a verdict is corrected, and how a new tail is added. The first
  // column is a hash prefix (8+ chars), matched against the index.
  const verdicts = new Map()
  const duplicates = []
  const bad = []
  const baseTsv = `${opts.docOut}.tsv`
  let baseCount = 0
  if (existsSync(baseTsv)) {
    const [baseHeader, ...baseRows] = readFileSync(baseTsv, 'utf8').trimEnd().split('\n')
    const bc = baseHeader.split('\t')
    const bcol = (name) => bc.indexOf(name)
    for (const line of baseRows) {
      const f = line.split('\t')
      const category = f[bcol('category')]
      if (!CATEGORY_IDS.includes(category)) continue // 'unclassified' rows carry no verdict
      verdicts.set(f[bcol('hash')].slice(0, 8), {
        category,
        flags: (f[bcol('flags')] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        rationale: tsvUnescape(f[bcol('rationale')] ?? '').trim(),
        alsoFixes: tsvUnescape(f[bcol('also_fixes')] ?? '').trim(),
      })
      baseCount++
    }
  }
  const seenInScratch = new Set()
  for (const name of readdirSync(opts.outDir)
    .filter((n) => /^verdicts-\d+\.tsv$/.test(n))
    .sort()) {
    const lines = readFileSync(join(opts.outDir, name), 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim() || line.startsWith('hash\t')) continue
      const [hash, category, flags = '', rationale = '', alsoFixes = ''] = line.split('\t')
      if (!CATEGORY_IDS.includes(category)) {
        bad.push(`${name}: ${hash} has unknown category "${category}"`)
        continue
      }
      // Keyed on the 8-char prefix like the base, so a scratch verdict written
      // with a longer prefix still overrides the base entry instead of sitting
      // beside it and losing the lookup below to whichever was inserted first.
      const key = hash.slice(0, 8)
      if (seenInScratch.has(key)) duplicates.push(`${name}: ${hash}`)
      seenInScratch.add(key)
      verdicts.set(key, {
        category,
        flags: flags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        rationale: tsvUnescape(rationale).trim(),
        alsoFixes: tsvUnescape(alsoFixes).trim(),
      })
    }
  }

  const unmatched = new Set(verdicts.keys())
  const joined = commits.map((c) => {
    const key = [...verdicts.keys()].find((k) => c.hash.startsWith(k))
    if (key) unmatched.delete(key)
    return {
      ...c,
      ...(key ? verdicts.get(key) : { category: null, flags: [], rationale: '', alsoFixes: '' }),
    }
  })
  const missing = joined.filter((c) => !c.category)

  for (const msg of bad) console.error(`bad verdict: ${msg}`)
  for (const msg of duplicates) console.error(`duplicate verdict: ${msg}`)
  for (const h of unmatched) console.error(`verdict matches no bundled commit: ${h}`)
  if (missing.length)
    console.error(
      `${missing.length} commit(s) have no verdict yet; they are listed as unclassified`
    )

  // TSV sidecar
  const tsv = ['hash\tdate\tsubject\tcategory\tflags\trationale\talso_fixes']
  for (const c of joined) {
    tsv.push(
      [
        c.hash,
        c.date,
        tsvEscape(c.subject),
        c.category ?? 'unclassified',
        c.flags.join(','),
        tsvEscape(c.rationale),
        tsvEscape(c.alsoFixes),
      ].join('\t')
    )
  }
  mkdirSync(dirname(opts.docOut) || '.', { recursive: true })
  writeFileSync(`${opts.docOut}.tsv`, tsv.join('\n') + '\n')

  // Markdown
  const repoUrl = githubUrl()
  const link = (hash) =>
    repoUrl ? `[\`${hash.slice(0, 8)}\`](${repoUrl}/commit/${hash})` : `\`${hash.slice(0, 8)}\``
  const cell = (s) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
  const counts = Object.fromEntries(
    CATEGORY_IDS.map((id) => [id, joined.filter((c) => c.category === id).length])
  )
  const alsoFixed = joined.filter((c) => c.alsoFixes && c.category !== 'fix-upstream')

  const md = []
  md.push('# Fork divergence')
  md.push('')
  md.push(
    'Every commit this fork carries over upstream, classified by what it did. Generated by `node scripts/fork-commit-bundle.mjs --assemble` from per-commit verdicts; do not edit by hand — correct the verdict and re-run.'
  )
  md.push('')
  if (range) {
    md.push(
      `Range \`${range.range}\` (${joined.length} non-merge commits), provenance measured against \`${range.base}\` at \`${range.baseTip.slice(0, 12)}\`, head \`${range.headTip.slice(0, 12)}\`, bundled ${range.bundledAt.slice(0, 10)}.`
    )
    md.push('')
  }
  md.push('## Summary')
  md.push('')
  md.push('| Category | Commits | Meaning |')
  md.push('| --- | ---: | --- |')
  for (const [id, label, def] of CATEGORIES) md.push(`| ${label} | ${counts[id]} | ${def} |`)
  if (missing.length) md.push(`| Unclassified | ${missing.length} | No verdict yet. |`)
  md.push('')
  md.push(
    `A further ${alsoFixed.length} commits in other categories also repair upstream behaviour on the way; they are listed at the end of the upstream fixes section.`
  )
  md.push('')
  md.push('## Method')
  md.push('')
  md.push(
    "Each commit was read from its message (subject and body), its file list with each path marked as existing upstream or created by the fork, and its diff where the message left the classification open. The classification rules are the table above. Two rules decide most borderline cases: a change that repairs behaviour a user could hit is a fix even when the repair adds code, and a fix found inside a commit whose main purpose is something else is recorded in that commit's `also_fixes` rather than changing its category. To extend the record after new commits land, re-run the bundle step, classify only the new tail into a `verdicts-NN.tsv` in the scratch directory, and re-run `--assemble`: every existing verdict is read back from `docs/fork-divergence.tsv`, and a scratch verdict for an existing commit replaces it."
  )
  md.push('')

  for (const [id, label] of CATEGORIES) {
    const list = joined.filter((c) => c.category === id)
    md.push(`## ${label} (${list.length})`)
    md.push('')
    if (list.length) {
      md.push('| Date | Commit | Subject | What it did |')
      md.push('| --- | --- | --- | --- |')
      for (const c of list)
        md.push(`| ${c.date} | ${link(c.hash)} | ${cell(c.subject)} | ${cell(c.rationale)} |`)
      md.push('')
    }
    if (id === 'fix-upstream' && alsoFixed.length) {
      md.push('### Upstream fixes carried inside other commits')
      md.push('')
      md.push('| Date | Commit | Subject | What it fixed |')
      md.push('| --- | --- | --- | --- |')
      for (const c of alsoFixed)
        md.push(`| ${c.date} | ${link(c.hash)} | ${cell(c.subject)} | ${cell(c.alsoFixes)} |`)
      md.push('')
    }
  }
  if (missing.length) {
    md.push(`## Unclassified (${missing.length})`)
    md.push('')
    md.push('| Date | Commit | Subject |')
    md.push('| --- | --- | --- |')
    for (const c of missing) md.push(`| ${c.date} | ${link(c.hash)} | ${cell(c.subject)} |`)
    md.push('')
  }
  writeFileSync(`${opts.docOut}.md`, md.join('\n'))

  console.log(
    `verdicts:     ${baseCount} from ${baseTsv}, ${seenInScratch.size} from ${opts.outDir}`
  )
  console.log(`commits:      ${joined.length}`)
  for (const [id, label] of CATEGORIES) console.log(`  ${label.padEnd(22)} ${counts[id]}`)
  console.log(`  ${'also fixes upstream'.padEnd(22)} ${alsoFixed.length}`)
  console.log(`  ${'unclassified'.padEnd(22)} ${missing.length}`)
  console.log(`output:       ${opts.docOut}.md + ${opts.docOut}.tsv`)
  if (bad.length || duplicates.length || unmatched.size) process.exitCode = 1
}

/** https://github.com/<owner>/<repo> for origin, or null when it is not GitHub. */
function githubUrl() {
  try {
    const url = git(['remote', 'get-url', 'origin'], true).trim()
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/)
    return m ? `https://github.com/${m[1]}/${m[2]}` : null
  } catch {
    return null
  }
}
