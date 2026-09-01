/**
 * Does the reasoning-effort setting actually do anything?
 *
 * THE QUESTION. `openrouter-capabilities.ts` now reads each model's
 * `reasoning.supported_efforts` from the catalog and the settings page offers
 * exactly that list. Three things have to be true for that to be worth
 * anything, and the catalog is evidence for only the first:
 *
 *   1. EVERY LISTED WORD IS ACCEPTED. If the catalog lists a word the endpoint
 *      rejects, the dropdown offers a level that 400s a batch job.
 *
 *   2. AN UNLISTED WORD IS REJECTED. If anything is accepted, the list is
 *      decoration and there was never a capability to read. This is the
 *      control, and it is the half that is easy to skip.
 *
 *   3. THE LEVEL CHANGES THE SCRATCHPAD. This is the whole point of the
 *      feature: a reasoning model bills its internal tokens from the same
 *      output allowance as the prose, so capping the effort is what buys the
 *      answer room. A field that is accepted, ignored, and still saved is
 *      exactly the failure F-097 records — a setting an operator can see, save
 *      and believe in while no request changes. Only `reasoning_tokens` in the
 *      response can answer it.
 *
 * WHY EACH LEVEL IS SENT TWICE. Reasoning length is not deterministic, and
 * OpenRouter routes each call independently between upstreams. One call per
 * level cannot distinguish "this level thinks less" from "that generation
 * happened to be shorter", so every level is measured twice and both numbers
 * are printed. A gap smaller than the spread between a level's own two runs is
 * not evidence of anything. Measured on gemini-3.5-flash, high repeated at
 * 1476/1529 — a spread of 53 — so the repeat is what makes a 100-token gap
 * between adjacent levels readable rather than a coin flip.
 *
 * WHY A PROMPT WITH REAL WORK IN IT. A trivial question is answered without
 * thinking at every level, which reads as "the parameter is ignored" when it
 * only means nothing was asked of it. The prompt below has a small amount of
 * genuine reasoning in it, of roughly the shape the batch writing roles do.
 *
 * Writes nothing. Touches no table. Reads the stored key, never an argument,
 * so no secret is typed or left in shell history.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\probe-reasoning-effort.mjs aperture:/tmp/reasoning.mjs
 *   docker exec aperture node /tmp/reasoning.mjs
 *
 * WHAT THIS COSTS, AND WHY THE DEFAULT IS SMALL. Every call here is billed to
 * the operator, so the default is the CHEAPEST SHAPE THAT STILL ANSWERS: the
 * model the role is actually configured with, its weakest and strongest levels
 * only, and the control. Six calls.
 *
 * The middle levels are not needed for the verdict. If the weakest level
 * reasons materially less than the strongest, the parameter is honoured; if it
 * does not, no amount of intermediate detail rescues it. The first version of
 * this script defaulted to three models from three vendors to watch their
 * vocabularies disagree — that is a fact about OpenRouter's catalogue, already
 * settled for free by reading /api/v1/models, and it is not worth a single paid
 * generation, let alone thirty.
 *
 * Options:
 *   --models a,b,c   comma-separated OpenRouter slugs (default: the configured
 *                    titleAnalysis or textGeneration model)
 *   --all-levels     every declared level plus a no-effort baseline (~2 calls
 *                    per level; only worth it to see the shape of the ladder)
 *   --skip-control   don't try the deliberately-invalid word (saves one call,
 *                    and gives up the check that the field is read at all)
 */

const CORE = '/app/packages/core/dist/index.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(name)

const skipControl = has('--skip-control')
const allLevels = has('--all-levels')

/** A word no vendor uses, to check the endpoint is reading the field at all. */
const CONTROL_WORD = 'aperture_not_a_level'

const PROMPT =
  'Three films: Stalker (1979), Solaris (1972), Annihilation (2018). ' +
  'Name the one structural element all three share that a plot summary would miss, ' +
  'in two sentences. Do not list the films back.'

const { getFunctionConfig, getSystemSetting } = await import(CORE)

// Mirrors withResolvedCredentials: a role may carry an inline key, but the
// settings UI writes the shared per-provider store, so checking only one of the
// two is how a key plainly visible in the UI reads as missing here.
async function openRouterKey() {
  for (const role of ['titleAnalysis', 'textGeneration', 'chat']) {
    const cfg = await getFunctionConfig(role)
    if (cfg?.provider === 'openrouter' && cfg.apiKey) return cfg.apiKey
  }
  const raw = await getSystemSetting('ai_provider_credentials')
  if (raw) {
    try {
      const creds = JSON.parse(raw)
      if (creds.openrouter?.apiKey) return creds.openrouter.apiKey
    } catch {
      console.error('warning: ai_provider_credentials did not parse')
    }
  }
  return null
}

const apiKey = await openRouterKey()
if (!apiKey) {
  console.error('No OpenRouter key found. Configure it in Settings > AI first.')
  process.exit(1)
}

/**
 * The model to probe: the one a reasoning-reading role is ACTUALLY pointed at.
 *
 * There is no hardcoded default list. Probing a model nobody here runs answers
 * a question nobody here asked, and bills the operator for it — which is
 * exactly what the first version of this script did.
 */
async function configuredModels() {
  const found = []
  for (const role of ['titleAnalysis', 'textGeneration']) {
    const cfg = await getFunctionConfig(role)
    if (cfg?.provider === 'openrouter' && cfg.model && !found.includes(cfg.model)) {
      found.push(cfg.model)
      console.log(`  using ${role}'s model: ${cfg.model}`)
    }
  }
  return found
}

const models = flag('--models', '')
  ? flag('--models', '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  : await configuredModels()

if (models.length === 0) {
  console.error(
    'Neither Title Analysis nor Text Generation is on an OpenRouter model, so there is ' +
      'nothing here worth paying to measure. Point a role at OpenRouter first, or name a ' +
      'model explicitly with --models <slug>.'
  )
  process.exit(1)
}

/** Weakest → strongest, mirroring core's KNOWN_REASONING_EFFORTS. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const byStrength = (list) =>
  [...list].sort((a, b) => {
    const r = (e) => {
      const i = EFFORT_ORDER.indexOf(e)
      return i === -1 ? EFFORT_ORDER.length : i
    }
    return r(a) - r(b)
  })

/** The catalog's own claim, which is what this script is checking. */
async function catalogEfforts(model) {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) return null
  const entry = (await res.json())?.data?.find((m) => m.id === model)
  return entry?.reasoning?.supported_efforts ?? null
}

/**
 * One call at one effort.
 *
 * Returns the reasoning-token count rather than the text: the text is not the
 * measurement, and printing it would bury the one number that is.
 */
async function callWithEffort(model, effort) {
  const body = {
    model,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: 2000,
  }
  if (effort != null) body.reasoning = { effort }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 200) }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, status: res.status, detail: 'response was not JSON' }
  }
  // OpenRouter answers some errors as HTTP 200 with an error body — the same
  // trap OMDb has (F-015). Checking res.ok alone would score those as passes.
  if (json.error) {
    return { ok: false, status: 200, detail: JSON.stringify(json.error).slice(0, 200) }
  }
  return {
    ok: true,
    reasoningTokens: json?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    completionTokens: json?.usage?.completion_tokens ?? null,
  }
}

/** Two calls, so a difference is measured rather than assumed. */
async function measure(model, effort) {
  const a = await callWithEffort(model, effort)
  if (!a.ok) return a
  const b = await callWithEffort(model, effort)
  if (!b.ok) return b
  return { ok: true, runs: [a.reasoningTokens, b.reasoningTokens] }
}

const summary = []

for (const model of models) {
  process.stdout.write(`\n=== ${model} ===\n`)

  const declared = await catalogEfforts(model)
  if (!declared) {
    console.log('  catalog declares no supported_efforts — no control is offered for this model')
    summary.push({ model, verdict: 'no efforts declared' })
    continue
  }
  console.log(`  catalog declares: ${declared.join(', ')}`)

  // The extremes are the whole verdict: if the weakest level reasons materially
  // less than the strongest, the parameter is honoured, and no intermediate
  // detail changes that answer. --all-levels buys the shape of the ladder.
  const ordered = byStrength(declared)
  const probe = allLevels ? ordered : [...new Set([ordered[0], ordered[ordered.length - 1]])]
  if (!allLevels && probe.length < ordered.length) {
    console.log(`  probing extremes only: ${probe.join(', ')}   (--all-levels for the rest)`)
  }

  // Baseline: no field at all, which is what every role sends today. ONE call —
  // it is context for what the current bill buys, not half of a comparison, and
  // it is labelled below as the single sample it is.
  const base = allLevels ? await measure(model, null) : await callWithEffort(model, null)
  const baseRuns = base.ok ? (base.runs ?? [base.reasoningTokens]) : null
  console.log(
    `  (no effort)   : ${base.ok ? `reasoning tokens ${baseRuns.join(' / ')}${allLevels ? '' : '  (1 sample)'}` : `FAILED ${base.status} ${base.detail}`}`
  )

  const observed = []
  for (const effort of probe) {
    const m = await measure(model, effort)
    if (!m.ok) {
      console.log(`  ${effort.padEnd(13)}: REJECTED ${m.status} — ${m.detail}`)
      observed.push({ effort, rejected: true })
      continue
    }
    console.log(`  ${effort.padEnd(13)}: reasoning tokens ${m.runs.join(' / ')}`)
    observed.push({ effort, runs: m.runs })
  }

  if (!skipControl) {
    const ctl = await callWithEffort(model, CONTROL_WORD)
    // The control has to FAIL. If a nonsense word is accepted, the endpoint is
    // not reading the field and the whole list is decoration.
    console.log(
      `  [control]     : "${CONTROL_WORD}" -> ${ctl.ok ? 'ACCEPTED — the field is NOT being read' : `rejected ${ctl.status} (correct)`}`
    )
    if (ctl.ok) summary.push({ model, verdict: 'CONTROL FAILED: unlisted word accepted' })
  }

  const usable = observed.filter((o) => !o.rejected && o.runs.some((r) => r != null))
  const rejected = observed.filter((o) => o.rejected).map((o) => o.effort)

  if (rejected.length > 0) {
    summary.push({ model, verdict: `catalog lists words the endpoint rejects: ${rejected.join(', ')}` })
  } else if (usable.length < 2) {
    summary.push({ model, verdict: 'no reasoning_tokens reported — effect not measurable here' })
  } else {
    // The question that matters: does the level move the scratchpad at all, and
    // is that movement bigger than a level's own run-to-run spread?
    const mids = usable.map((o) => ({
      effort: o.effort,
      mid: (o.runs[0] + o.runs[1]) / 2,
      spread: Math.abs(o.runs[0] - o.runs[1]),
    }))
    const lo = mids.reduce((a, b) => (a.mid < b.mid ? a : b))
    const hi = mids.reduce((a, b) => (a.mid > b.mid ? a : b))
    const noise = Math.max(...mids.map((m) => m.spread))
    const gap = hi.mid - lo.mid
    console.log(
      `  => ${lo.effort} ~${Math.round(lo.mid)} vs ${hi.effort} ~${Math.round(hi.mid)} tokens; ` +
        `largest within-level spread ${Math.round(noise)}`
    )
    summary.push({
      model,
      verdict:
        gap > noise
          ? `effort works (${Math.round(gap)} tokens between levels, above the ${Math.round(noise)} noise floor)`
          : `NO measurable effect (${Math.round(gap)} tokens vs ${Math.round(noise)} noise) — treat as ignored`,
    })
  }
}

console.log('\n\n=== summary ===\n')
for (const s of summary) console.log(`  ${s.model.padEnd(30)} ${s.verdict}`)
console.log(
  '\nWhat each verdict means for the app:\n' +
    '  "effort works"            -> the dropdown is doing what it claims.\n' +
    '  "NO measurable effect"    -> the model accepts the field and ignores it. The\n' +
    '                               setting is then cosmetic FOR THAT MODEL; nothing\n' +
    '                               breaks, but it buys no answer room.\n' +
    '  "endpoint rejects"        -> the catalog is wrong for that model and the\n' +
    '                               dropdown offers a level that 400s a batch job.\n' +
    '  "CONTROL FAILED"          -> the field is not read at all; stop trusting\n' +
    '                               supported_efforts for this model.\n'
)

process.exit(0)
