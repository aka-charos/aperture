/**
 * Does the stored title analysis help — the claim checker, the embeddings, or
 * both? One pass over the claim set, two measurements.
 *
 * CONTEXT. The first claim check (probe-claim-check.mjs) found the decision
 * model separating real connections from stretches well (perfect controls,
 * AUC 0.83-0.86) but rejecting most real ones, and the rejected claims leaned
 * on things its state did not carry: country (absent from the title
 * description entirely) and anything about style or subject past a 500-char
 * synopsis and twelve keywords. The library holds a better account of each
 * title — the analysis's "what it is doing" and "where it sits" paragraphs —
 * and the same question applies to the vectors: today's embedded text
 * deliberately leaves that prose out (see buildCanonicalText's comment on
 * coverage asymmetry).
 *
 * PART A — THE CLAIM CHECK AGAIN, SAME 307 CLAIMS, SAME TWO QUESTIONS. Only
 * the state changes, in two steps so each addition is measured alone:
 *   country            + each title's production countries
 *   country+analysis   + the analysis paragraphs, clipped exactly as the
 *                        explanation writer receives them (350 chars each)
 * A claim neither of whose titles has an analysis would send the identical
 * request twice, so the second is not sent and the answer is reused.
 *
 * PART B — THE EMBEDDINGS, NOTHING STORED. For every title in the claim set:
 *   stored   the vector in the live set (read, not computed)
 *   base     its stored canonical text, embedded again now — a control: it
 *            should match `stored` almost exactly, and if it does not, the
 *            comparison below is between two pipelines, not two texts
 *   clipped  that text plus the two analysis paragraphs as the writer gets them
 *   full     that text plus the two paragraphs whole
 * and for every pick/watched pair in the claim set, the raw cosine under each.
 * Raw, because that is what the evidence lookup uses. A title without an
 * analysis keeps its base vector in every variant, so only pairs where BOTH
 * titles are analysed compare two texts cleanly; the analysis says so.
 *
 * WHAT PART B CANNOT ANSWER: anything library-wide. With a few hundred titles
 * analysed out of thousands, it cannot show the coverage effect (analysed
 * titles drifting toward each other because they share a register), the
 * neighbour lists, or the recommendation metrics. Those need the library
 * analysed and `evaluate-recommender`. This says only whether the prose moves
 * the labelled pairs in the right direction.
 *
 * Costs: Part A up to ~600 decision-model calls (fewer: identical requests are
 * skipped); Part B roughly three embedding requests per analysed title, batched.
 * Spend is recorded under "probe:analysis-grounding". Reads settings and the
 * stored keys; writes nothing but spend rows.
 *
 * Usage, from the Docker host (after probe-analyse-claim-titles.mjs is done):
 *
 *   docker cp probe-analysis-grounding.mjs aperture:/tmp/grounding.mjs
 *   docker cp claims.json aperture:/tmp/claims.json
 *   docker exec aperture node /tmp/grounding.mjs /tmp/claims.json /tmp/grounding-results.jsonl --dry
 *   docker exec aperture node /tmp/grounding.mjs /tmp/claims.json /tmp/grounding-results.jsonl
 *   docker cp aperture:/tmp/grounding-results.jsonl grounding-results.jsonl
 *
 * Interrupted? Run it again: Part A skips every claim already answered, and
 * Part B (quick) is redone whole.
 *
 * Options:
 *   --dry               report coverage (titles analysed, pairs with both sides
 *                       analysed, stored vectors found) and call nothing
 *   --skip-claims       Part B only
 *   --skip-embeddings   Part A only
 */
import fs from 'node:fs'

const CORE = '/app/packages/core/dist'
const argv = process.argv.slice(2)
const [claimsPath, outPath] = argv.filter((a) => !a.startsWith('--'))
if (!claimsPath || !outPath) {
  console.error('usage: node grounding.mjs <claims.json> <results.jsonl> [--dry] [--skip-claims] [--skip-embeddings]')
  process.exit(2)
}
const dry = argv.includes('--dry')
const doClaims = !argv.includes('--skip-claims')
const doEmbeddings = !argv.includes('--skip-embeddings')

const { query } = await import(`${CORE}/lib/db.js`)
const { withInferenceContext } = await import(`${CORE}/lib/inferenceContext.js`)
const { selectAnalysisGrounding } = await import(`${CORE}/analysis/grounding.js`)
const { buildAnalysisSegments } = await import(`${CORE}/analysis/segments.js`)

const claims = JSON.parse(fs.readFileSync(claimsPath, 'utf8'))
const keyOf = (mediaType, f) => `${mediaType}|${f.title}|${f.year ?? ''}`

// ---------------------------------------------------------------- titles
const titles = new Map()
for (const c of claims) {
  for (const f of [c.pick, c.watched]) {
    const key = keyOf(c.mediaType, f)
    if (!titles.has(key)) titles.set(key, { key, mediaType: c.mediaType, title: f.title, year: f.year ?? null })
  }
}
for (const t of titles.values()) {
  const table = t.mediaType === 'movie' ? 'movies' : 'series'
  const rows = await query(
    `SELECT id, production_countries FROM ${table} WHERE title = $1 AND year IS NOT DISTINCT FROM $2 ORDER BY created_at LIMIT 1`,
    [t.title, t.year]
  )
  t.id = rows.rows[0]?.id ?? null
  t.country = (rows.rows[0]?.production_countries ?? []).filter(Boolean).slice(0, 3)
}

const LABEL = { work: 'What it is doing', tradition: 'Where it sits' }
const versions = {}
for (const mediaType of ['movie', 'series']) {
  const ids = [...titles.values()].filter((t) => t.mediaType === mediaType && t.id).map((t) => t.id)
  if (ids.length === 0) continue
  const rows = await query(
    `SELECT media_id, analysis, paragraph_map, prompt_version FROM title_analysis
      WHERE media_type = $1 AND media_id = ANY($2::uuid[]) AND analysis IS NOT NULL`,
    [mediaType, ids]
  )
  const byId = new Map(rows.rows.map((r) => [r.media_id, r]))
  for (const t of titles.values()) {
    if (t.mediaType !== mediaType || !t.id) continue
    const row = byId.get(t.id)
    if (!row) continue
    // Clipped: exactly what the explanation writer is handed (grounding.ts).
    const clipped = selectAnalysisGrounding(row.analysis, row.paragraph_map)
    if (clipped.length === 0) continue
    // Full: the same two segments, whole.
    const segments = buildAnalysisSegments(row.analysis, row.paragraph_map)
    const full = ['work', 'tradition']
      .map((q) => ({ question: q, text: segments.find((s) => s.questions.includes(q))?.text?.trim() }))
      .filter((p) => p.text)
    t.analysis = { clipped, full, version: row.prompt_version }
    versions[row.prompt_version] = (versions[row.prompt_version] ?? 0) + 1
  }
}

const all = [...titles.values()]
const analysed = (f, mediaType) => !!titles.get(keyOf(mediaType, f))?.analysis
const bothAnalysed = claims.filter((c) => analysed(c.pick, c.mediaType) && analysed(c.watched, c.mediaType)).length
const eitherAnalysed = claims.filter((c) => analysed(c.pick, c.mediaType) || analysed(c.watched, c.mediaType)).length
console.log(
  `${all.length} titles, ${all.filter((t) => t.id).length} found in the library, ` +
    `${all.filter((t) => t.analysis).length} with usable analysis paragraphs (by prompt version: ${JSON.stringify(versions)}); ` +
    `${all.filter((t) => t.country.length).length} with a country`
)
console.log(`claims: ${claims.length}; both titles analysed ${bothAnalysed}; at least one ${eitherAnalysed}`)

// Results so far, so an interrupted run resumes.
const done = new Set()
if (fs.existsSync(outPath)) {
  for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r.part === 'claim' && (r.sameAs || (r.holds != null && r.generic != null))) done.add(`${r.variant}:${r.id}`)
    } catch {
      // a line cut off by an interruption is asked again
    }
  }
}
// Part B is rewritten whole each run; keep only Part A's lines.
if (fs.existsSync(outPath) && doEmbeddings && !dry) {
  const keep = fs
    .readFileSync(outPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !/"part":"(pair|title|meta)"/.test(line))
  fs.writeFileSync(outPath, keep.length ? `${keep.join('\n')}\n` : '')
}

// ---------------------------------------------------------------- part A
const clip = (text, max) => {
  if (!text) return null
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = cut.lastIndexOf(' ')
  return `${(end > max * 0.6 ? cut.slice(0, end) : cut).trim()}…`
}
// describeTitle from recommender/evidenceJudgment.ts, plus the two additions.
function describe(f, mediaType, variant) {
  const t = titles.get(keyOf(mediaType, f))
  const entry = { title: f.title }
  if (f.year != null) entry.year = f.year
  if (f.genres?.length) entry.genres = f.genres
  const creators = (f.creators ?? []).filter(Boolean).slice(0, 3)
  if (creators.length) entry[mediaType === 'movie' ? 'directedBy' : 'createdBy'] = creators
  if (f.franchise) entry.franchise = f.franchise
  if (f.network) entry.network = f.network
  if (t?.country?.length) entry.country = t.country
  const themes = (f.themes ?? []).filter(Boolean).slice(0, 12)
  if (themes.length) entry.themes = themes
  const synopsis = clip(f.synopsis, 500)
  if (synopsis) entry.synopsis = synopsis
  if (variant === 'country+analysis' && t?.analysis) {
    entry.analysis = Object.fromEntries(t.analysis.clipped.map((p) => [LABEL[p.question] ?? p.question, p.text]))
  }
  return entry
}
const label = (f) => (f.year != null ? `"${f.title}" (${f.year})` : `"${f.title}"`)
// The questions are byte-identical to the first run's, so only the state moved.
function buildCall(c, model, variant) {
  const noun = c.mediaType === 'movie' ? 'films' : 'series'
  const a = label(c.pick)
  const b = label(c.watched)
  return {
    model,
    state: {
      mediaType: c.mediaType === 'movie' ? 'film' : 'series',
      recommended: describe(c.pick, c.mediaType, variant),
      watched: describe(c.watched, c.mediaType, variant),
      statement: c.claim,
    },
    questions: {
      holds: {
        type: 'noul',
        instructions:
          `The statement is about ${a} (recommended) and ${b} (watched). ` +
          `Judging only from the information in the state, is the statement accurate for BOTH of them?`,
        criteria: {
          true: 'What the state says about each of the two titles fits the statement',
          false:
            'The state contradicts the statement for either title, or gives no sign of what it describes for one of them',
        },
      },
      generic: {
        type: 'noul',
        instructions:
          `Is the statement so general that it would be just as true of most ${noun} in the same genres as ${a} and ${b}, ` +
          `rather than naming something particular that these two share and most others do not?`,
        criteria: {
          true: `It would fit most ${noun} of these genres; it names nothing particular to these two`,
          false: `It names something particular these two share that most ${noun} of their genres do not`,
        },
      },
    },
  }
}

if (dry) {
  const sample = claims.find((c) => analysed(c.pick, c.mediaType) && analysed(c.watched, c.mediaType)) ?? claims[0]
  console.log('\nfirst country+analysis request:')
  console.log(JSON.stringify(buildCall(sample, '(configured model)', 'country+analysis'), null, 2))
}

if (doClaims && !dry) {
  const { getDecisionModelConfig, sanitizeDecisionModelConfig } = await import(`${CORE}/index.js`)
  const { resolveDecisionEndpoint, callSystemOne } = await import(`${CORE}/lib/decisionModel.js`)
  const { readNoul } = await import(`${CORE}/lib/decisionModelRules.js`)
  const config = sanitizeDecisionModelConfig({ ...(await getDecisionModelConfig()), enabled: true })
  const resolved = await resolveDecisionEndpoint(config)
  if (!resolved.ok) {
    console.error(`The decision model cannot be called: ${resolved.reason}`)
    process.exit(1)
  }

  const out = fs.createWriteStream(outPath, { flags: 'a' })
  const jobs = []
  for (const variant of ['country', 'country+analysis']) {
    for (const c of claims) {
      if (done.has(`${variant}:${c.id}`)) continue
      const either = analysed(c.pick, c.mediaType) || analysed(c.watched, c.mediaType)
      if (variant === 'country+analysis' && !either) {
        out.write(`${JSON.stringify({ part: 'claim', variant, id: c.id, sameAs: 'country' })}\n`)
        continue
      }
      jobs.push({ c, variant })
    }
  }
  console.log(`\npart A: ${jobs.length} calls to make (${config.model}, ${config.concurrency} at once)`)

  let next = 0
  let finished = 0
  let failed = 0
  let consecutive = 0
  let stopped = null
  const worker = async () => {
    for (;;) {
      if (stopped) return
      const job = jobs[next++]
      if (!job) return
      const { c, variant } = job
      try {
        const answer = await callSystemOne(resolved.endpoint, buildCall(c, config.model, variant), config.timeoutMs)
        const holds = readNoul(answer.answers?.holds)
        const generic = readNoul(answer.answers?.generic)
        if (holds == null || generic == null) throw new Error('an answer was missing')
        out.write(
          `${JSON.stringify({
            part: 'claim',
            variant,
            id: c.id,
            holds,
            generic,
            pickAnalysed: analysed(c.pick, c.mediaType),
            watchedAnalysed: analysed(c.watched, c.mediaType),
            model: answer.model,
          })}\n`
        )
        consecutive = 0
      } catch (err) {
        failed++
        consecutive++
        out.write(`${JSON.stringify({ part: 'claim', variant, id: c.id, error: String(err?.message ?? err), status: err?.status })}\n`)
        if ([401, 402, 403, 404].includes(err?.status)) stopped = `HTTP ${err.status}: ${err.message}`
        else if (consecutive >= 5) stopped = `${consecutive} calls failed in a row (last: ${err?.message ?? err})`
      }
      finished++
      if (finished % 50 === 0 || finished === jobs.length) console.log(`  ${finished}/${jobs.length}`)
    }
  }
  await withInferenceContext({ feature: 'probe:analysis-grounding' }, () =>
    Promise.all(Array.from({ length: Math.max(1, Math.min(config.concurrency, jobs.length)) }, worker))
  )
  await new Promise((resolve) => out.end(resolve))
  if (stopped) console.log(`part A stopped early: ${stopped}. Run again to continue.`)
  console.log(`part A: ${finished - failed} answered, ${failed} failed`)
}

// ---------------------------------------------------------------- part B
if (doEmbeddings) {
  const { getEmbeddingInvocation, getActiveEmbeddingTableName } = await import(`${CORE}/lib/ai-provider.js`)
  const invocation = await getEmbeddingInvocation()
  const tables = {
    movie: await getActiveEmbeddingTableName('embeddings'),
    series: await getActiveEmbeddingTableName('series_embeddings'),
  }

  for (const mediaType of ['movie', 'series']) {
    const ids = all.filter((t) => t.mediaType === mediaType && t.id).map((t) => t.id)
    if (ids.length === 0) continue
    const idColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'
    const rows = await query(
      `SELECT ${idColumn} AS id, canonical_text, embedding::text AS embedding FROM ${tables[mediaType]}
        WHERE model = $1 AND ${idColumn} = ANY($2::uuid[])`,
      [invocation.setId, ids]
    )
    const byId = new Map(rows.rows.map((r) => [r.id, r]))
    for (const t of all) {
      if (t.mediaType !== mediaType || !t.id) continue
      const row = byId.get(t.id)
      if (!row?.canonical_text || !row.embedding) continue
      t.canonical = row.canonical_text
      // pgvector's text form is a JSON array.
      t.vectors = { stored: JSON.parse(row.embedding) }
    }
  }
  const embeddable = all.filter((t) => t.canonical)
  const section = (parts) => parts.map((p) => `${LABEL[p.question] ?? p.question}: ${p.text}`).join('\n')
  const texts = []
  for (const t of embeddable) {
    texts.push({ t, variant: 'base', text: t.canonical })
    if (t.analysis) {
      texts.push({ t, variant: 'clipped', text: `${t.canonical}\n${section(t.analysis.clipped)}` })
      texts.push({ t, variant: 'full', text: `${t.canonical}\n${section(t.analysis.full)}` })
    }
  }
  console.log(
    `\npart B: set ${invocation.setId}; ${embeddable.length} titles with a stored vector; ${texts.length} texts to embed`
  )

  if (!dry) {
    const BATCH = 32
    await withInferenceContext({ feature: 'probe:analysis-grounding' }, async () => {
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH)
        const vectors = await invocation.embedBatch(batch.map((b) => b.text))
        batch.forEach((b, j) => {
          b.t.vectors[b.variant] = vectors[j]
        })
        console.log(`  embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}`)
      }
    })

    const cosine = (a, b) => {
      let dot = 0
      let na = 0
      let nb = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb))
    }
    // A title with no analysis keeps its base vector in the analysis variants.
    const vec = (t, variant) => t.vectors[variant] ?? t.vectors.base

    const out = fs.createWriteStream(outPath, { flags: 'a' })
    out.write(`${JSON.stringify({ part: 'meta', setId: invocation.setId, versions })}\n`)
    for (const t of embeddable) {
      out.write(
        `${JSON.stringify({
          part: 'title',
          key: t.key,
          analysed: !!t.analysis,
          canonicalChars: t.canonical.length,
          clippedChars: t.analysis ? section(t.analysis.clipped).length : 0,
          fullChars: t.analysis ? section(t.analysis.full).length : 0,
          // The control: re-embedding the stored text should give the stored vector.
          baseVsStored: cosine(t.vectors.base, t.vectors.stored),
          clippedVsBase: t.analysis ? cosine(t.vectors.clipped, t.vectors.base) : null,
          fullVsBase: t.analysis ? cosine(t.vectors.full, t.vectors.base) : null,
        })}\n`
      )
    }
    const seen = new Set()
    for (const c of claims) {
      const a = titles.get(keyOf(c.mediaType, c.pick))
      const b = titles.get(keyOf(c.mediaType, c.watched))
      const pairKey = `${a.key}>${b.key}`
      if (seen.has(pairKey) || !a.vectors?.base || !b.vectors?.base) continue
      seen.add(pairKey)
      out.write(
        `${JSON.stringify({
          part: 'pair',
          pick: a.key,
          watched: b.key,
          pickAnalysed: !!a.analysis,
          watchedAnalysed: !!b.analysis,
          stored: cosine(a.vectors.stored, b.vectors.stored),
          base: cosine(vec(a, 'base'), vec(b, 'base')),
          clipped: cosine(vec(a, 'clipped'), vec(b, 'clipped')),
          full: cosine(vec(a, 'full'), vec(b, 'full')),
        })}\n`
      )
    }
    await new Promise((resolve) => out.end(resolve))
    console.log(`part B: ${seen.size} pairs written`)
  }
}

console.log(dry ? 'dry run: nothing called' : `done -> ${outPath}`)
process.exit(0)
