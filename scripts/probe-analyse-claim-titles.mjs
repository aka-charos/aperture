/**
 * Write the title analyses for the titles in the claim check, and only those.
 *
 * WHY NOT THE JOB. `generate-title-analysis` walks the whole library, current
 * picks first and then newest-added, so the watched titles the claim check
 * pairs them with — older films sitting in viewers' histories — would come
 * last, after hundreds of titles this measurement does not need. This runs the
 * job's own per-title step (`analyseTitle`, the choke point every path uses,
 * readiness check and pacing included) over the claim set's titles alone.
 *
 * Same rules as the job: a title already analysed under the current prompt
 * version, or declined under it, is skipped; a failure writes nothing and
 * leaves the title pending, so running this again picks up exactly what is
 * left; five failures in a row stop the run, since that is the retrieval
 * service or the model rather than the titles. Titles are taken in order of
 * how many claims mention them, so a partial run covers the most claims.
 *
 * Each title is a paid generation by the Title Analysis model and takes about
 * a minute (45 seconds to three minutes), so a full pass over ~200 titles is
 * hours: run it detached and read the log. Spend is recorded under the
 * feature "probe:claim-titles". Do not run the library job at the same time;
 * the two could pick the same title.
 *
 * Usage, from the Docker host:
 *
 *   docker cp probe-analyse-claim-titles.mjs aperture:/tmp/analyse-titles.mjs
 *   docker cp claims.json aperture:/tmp/claims.json
 *   docker exec aperture node /tmp/analyse-titles.mjs /tmp/claims.json --dry
 *   docker exec -d aperture sh -c "node /tmp/analyse-titles.mjs /tmp/claims.json > /tmp/analyse-titles.log 2>&1"
 *   docker exec aperture tail -n 20 /tmp/analyse-titles.log
 *
 * Options:
 *   --dry       count what is pending and list it; calls nothing
 *   --limit N   analyse at most N titles this run
 */
import fs from 'node:fs'

const CORE = '/app/packages/core/dist'
const argv = process.argv.slice(2)
const claimsPath = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--limit'))
if (!claimsPath) {
  console.error('usage: node analyse-titles.mjs <claims.json> [--dry] [--limit N]')
  process.exit(2)
}
const dry = argv.includes('--dry')
const limitAt = argv.indexOf('--limit')
const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) || Infinity : Infinity

const { query } = await import(`${CORE}/lib/db.js`)
const { withInferenceContext } = await import(`${CORE}/lib/inferenceContext.js`)
const { ANALYSIS_PROMPT_VERSION } = await import(`${CORE}/analysis/prompt.js`)
const { pendingAnalysisFromSql } = await import(`${CORE}/analysis/pending.js`)
const { loadAnalysisSubject } = await import(`${CORE}/analysis/titles.js`)
const { analyseTitle } = await import(`${CORE}/analysis/generate.js`)

// The claim set's titles, most-mentioned first.
const claims = JSON.parse(fs.readFileSync(claimsPath, 'utf8'))
const wanted = new Map()
for (const c of claims) {
  for (const f of [c.pick, c.watched]) {
    const key = `${c.mediaType}|${f.title}|${f.year ?? ''}`
    const w = wanted.get(key) ?? { mediaType: c.mediaType, title: f.title, year: f.year ?? null, mentions: 0 }
    w.mentions++
    wanted.set(key, w)
  }
}

// Resolve to library ids by the stored title and year (the claim file was
// exported from these columns, so an exact match is the right test).
const targets = []
let unresolved = 0
for (const w of wanted.values()) {
  const table = w.mediaType === 'movie' ? 'movies' : 'series'
  const rows = await query(
    `SELECT id FROM ${table} WHERE title = $1 AND year IS NOT DISTINCT FROM $2`,
    [w.title, w.year]
  )
  if (rows.rows.length === 0) {
    unresolved++
    console.log(`not in the library any more: ${w.title} (${w.year ?? '?'})`)
    continue
  }
  for (const row of rows.rows) targets.push({ ...w, id: row.id })
}

// Keep only what the job itself would consider pending: no row, or a row from
// an older prompt version. A current-version decline is an answer, not a gap.
const pending = []
for (const mediaType of ['movie', 'series']) {
  const ids = targets.filter((t) => t.mediaType === mediaType).map((t) => t.id)
  if (ids.length === 0) continue
  const rows = await query(
    `SELECT m.id ${pendingAnalysisFromSql(mediaType, '$1')} AND m.id = ANY($2::uuid[])`,
    [ANALYSIS_PROMPT_VERSION, ids]
  )
  const open = new Set(rows.rows.map((r) => r.id))
  pending.push(...targets.filter((t) => t.mediaType === mediaType && open.has(t.id)))
}
pending.sort((a, b) => b.mentions - a.mentions || a.title.localeCompare(b.title))

console.log(
  `${wanted.size} titles in the claim set; ${targets.length - pending.length} already analysed or declined ` +
    `under prompt version ${ANALYSIS_PROMPT_VERSION}; ${pending.length} pending${unresolved ? `; ${unresolved} not found` : ''}`
)
if (dry) {
  for (const t of pending) console.log(`  ${t.mediaType.padEnd(6)} ${t.title} (${t.year ?? '?'}) — in ${t.mentions} claim(s)`)
  process.exit(0)
}

const todo = pending.slice(0, limit)
let stored = 0
let declined = 0
let failed = 0
let consecutive = 0
const started = Date.now()

await withInferenceContext({ feature: 'probe:claim-titles' }, async () => {
  for (const [i, t] of todo.entries()) {
    const subject = await loadAnalysisSubject(t.mediaType, t.id)
    if (!subject) {
      console.log(`[${i + 1}/${todo.length}] ${t.title}: gone from the library, skipped`)
      continue
    }
    const t0 = Date.now()
    console.log(`[${i + 1}/${todo.length}] ${t.title} (${t.year ?? '?'})…`)
    try {
      const result = await analyseTitle(t.mediaType, t.id, subject, {
        onWait: (seconds) => console.log(`   pacing: waiting ${seconds}s before the next model call`),
      })
      const secs = Math.round((Date.now() - t0) / 1000)
      consecutive = 0
      if (result.analysis) {
        stored++
        console.log(`   stored ${result.analysis.length} chars from ${result.sourceCount ?? 0} source(s) in ${secs}s`)
      } else {
        declined++
        console.log(`   declined (${result.declineReason ?? 'no reason recorded'}) after ${secs}s`)
      }
    } catch (err) {
      failed++
      consecutive++
      console.log(`   FAILED, stays pending: ${err instanceof Error ? err.message : String(err)}`)
      if (consecutive >= 5) {
        console.log('Stopped after 5 failures in a row: the retrieval service or the model, not these titles.')
        break
      }
    }
  }
})

const mins = Math.round((Date.now() - started) / 60000)
console.log(`done in ${mins} min: ${stored} stored, ${declined} declined, ${failed} failed (failures stay pending; run again to retry)`)
process.exit(0)
