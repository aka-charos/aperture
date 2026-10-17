/**
 * Can the decision model tell a real connection from a stretch?
 *
 * THE QUESTION. The explanation writer links a recommendation to titles the
 * viewer watched, and reading its output shows those links made at whatever
 * level of abstraction makes them true ("a misfit team facing their pasts" is
 * a link; "someone supremely good at one narrow thing" fits half of cinema).
 * The proposed fix has the writer state each link as one sentence and the
 * decision model check it with two yes/no questions:
 *
 *   holds    — is the statement accurate for BOTH titles, judged from the data?
 *   generic  — would it be just as true of most titles in their genres?
 *
 * A link survives only when it holds and is not generic. Before building that,
 * this measures whether the two questions separate anything.
 *
 * THE CLAIMS (claims.json, built outside this script). Three kinds, mixed and
 * shuffled so nothing about a claim's kind is carried by its position:
 *   - connections the live explanations actually asserted, one title-free
 *     sentence each, read and labelled blind (real / generic / wrong) — the
 *     labels stay off this machine and are never sent anywhere;
 *   - each claim read as real, put to an UNRELATED pair — a control that
 *     needs no reading: it should not hold;
 *   - four sentences true of nearly any two titles ("both feature characters
 *     facing difficult choices") put to real pairs — it should read as generic.
 *
 * WHAT THE MODEL IS SHOWN. The same title description the evidence judge uses
 * (title, year, genres, director or creator, franchise, network, up to twelve
 * themes, 500 characters of synopsis) for the recommendation and the watched
 * title, plus the statement. Nothing about the viewer.
 *
 * Writes nothing to the database except the usual spend rows (the calls are
 * metered like every decision-model call). Reads the decision model settings
 * and the stored key; no secret is typed or printed.
 *
 * Usage, from the Docker host:
 *
 *   docker cp probe-claim-check.mjs aperture:/tmp/claim-check.mjs
 *   docker cp claims.json aperture:/tmp/claims.json
 *   docker exec aperture node /tmp/claim-check.mjs /tmp/claims.json /tmp/claim-results.jsonl
 *   docker cp aperture:/tmp/claim-results.jsonl claim-results.jsonl
 *
 * One call per claim (about 300). Interrupted? Run the same command again: it
 * appends, and skips every claim already answered.
 *
 * Options:
 *   --limit N    ask only the first N claims (a quick check that it works)
 *   --repeat N   ask every claim N times (default 1), to see how stable the
 *                answers are; a difference smaller than that spread is noise
 *   --dry        print the first request and exit, calling nothing
 */
import fs from 'node:fs'

const CORE = '/app/packages/core/dist'

const argv = process.argv.slice(2)
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const [claimsPath, resultsPath] = positional
if (!claimsPath || !resultsPath) {
  console.error('usage: node claim-check.mjs <claims.json> <results.jsonl> [--limit N] [--repeat N]')
  process.exit(2)
}
const limit = Number(flag('--limit', '0')) || Infinity
const repeat = Math.max(1, Number(flag('--repeat', '1')) || 1)

// Mirrors describeTitle in recommender/evidenceJudgment.ts, so the model sees
// a title exactly as the evidence judge shows it one.
const clip = (text, max) => {
  if (!text) return null
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = cut.lastIndexOf(' ')
  return `${(end > max * 0.6 ? cut.slice(0, end) : cut).trim()}…`
}
function describe(f, mediaType) {
  const entry = { title: f.title }
  if (f.year != null) entry.year = f.year
  if (f.genres?.length) entry.genres = f.genres
  const creators = (f.creators ?? []).filter(Boolean).slice(0, 3)
  if (creators.length) entry[mediaType === 'movie' ? 'directedBy' : 'createdBy'] = creators
  if (f.franchise) entry.franchise = f.franchise
  if (f.network) entry.network = f.network
  const themes = (f.themes ?? []).filter(Boolean).slice(0, 12)
  if (themes.length) entry.themes = themes
  const synopsis = clip(f.synopsis, 500)
  if (synopsis) entry.synopsis = synopsis
  return entry
}
const label = (f) => (f.year != null ? `"${f.title}" (${f.year})` : `"${f.title}"`)

function buildCall(c, model) {
  const noun = c.mediaType === 'movie' ? 'films' : 'series'
  const a = label(c.pick)
  const b = label(c.watched)
  return {
    model,
    state: {
      mediaType: c.mediaType === 'movie' ? 'film' : 'series',
      recommended: describe(c.pick, c.mediaType),
      watched: describe(c.watched, c.mediaType),
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

const claims = JSON.parse(fs.readFileSync(claimsPath, 'utf8')).slice(0, limit)

// --dry prints the first request and exits without calling anything, so the
// request can be read before a single paid call is made.
if (argv.includes('--dry')) {
  console.log(JSON.stringify(buildCall(claims[0], '(configured model)'), null, 2))
  process.exit(0)
}

const { getDecisionModelConfig, sanitizeDecisionModelConfig } = await import(`${CORE}/index.js`)
const { resolveDecisionEndpoint, callSystemOne } = await import(`${CORE}/lib/decisionModel.js`)
const { readNoul } = await import(`${CORE}/lib/decisionModelRules.js`)

const config = sanitizeDecisionModelConfig({ ...(await getDecisionModelConfig()), enabled: true })
const resolved = await resolveDecisionEndpoint(config)
if (!resolved.ok) {
  console.error(`The decision model cannot be called: ${resolved.reason}`)
  process.exit(1)
}
console.error(`model ${config.model}, ${config.concurrency} at once, ${config.timeoutMs} ms per call`)

const done = new Set()
if (fs.existsSync(resultsPath)) {
  for (const line of fs.readFileSync(resultsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r.holds != null && r.generic != null) done.add(`${r.id}:${r.run}`)
    } catch {
      // a line cut off by an interruption is asked again
    }
  }
}

const jobs = []
for (let run = 1; run <= repeat; run++) for (const c of claims) if (!done.has(`${c.id}:${run}`)) jobs.push({ c, run })
console.error(`${claims.length} claims x ${repeat}; ${done.size} already answered, ${jobs.length} to ask`)

const out = fs.createWriteStream(resultsPath, { flags: 'a' })
let next = 0
let finished = 0
let failed = 0
let consecutive = 0
let stopped = null

async function worker() {
  for (;;) {
    if (stopped) return
    const job = jobs[next++]
    if (!job) return
    const { c, run } = job
    try {
      const answer = await callSystemOne(resolved.endpoint, buildCall(c, config.model), config.timeoutMs)
      const holds = readNoul(answer.answers?.holds)
      const generic = readNoul(answer.answers?.generic)
      if (holds == null || generic == null) throw new Error('an answer was missing')
      out.write(`${JSON.stringify({ id: c.id, run, holds, generic, model: answer.model, ms: answer.latencyMs })}\n`)
      consecutive = 0
    } catch (err) {
      failed++
      consecutive++
      const status = err?.status
      out.write(`${JSON.stringify({ id: c.id, run, error: String(err?.message ?? err), status })}\n`)
      // The same rule the job uses: an auth or billing refusal will not get
      // better by asking again, and five failures in a row is not bad luck.
      if ([401, 402, 403, 404].includes(status)) stopped = `HTTP ${status}: ${err.message}`
      else if (consecutive >= 5) stopped = `${consecutive} calls failed in a row (last: ${err?.message ?? err})`
    }
    finished++
    if (finished % 25 === 0 || finished === jobs.length) console.error(`  ${finished}/${jobs.length}`)
  }
}

await Promise.all(Array.from({ length: Math.max(1, Math.min(config.concurrency, jobs.length)) }, worker))
await new Promise((resolve) => out.end(resolve))
if (stopped) console.error(`Stopped early: ${stopped}. Run the same command again to continue.`)
console.error(`done: ${finished - failed} answered, ${failed} failed -> ${resultsPath}`)
process.exit(0)
