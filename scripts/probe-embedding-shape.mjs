/**
 * What shape does this embedding model actually return?
 *
 * THE QUESTION. Three facts decide whether a model can be used here, and the
 * catalogue metadata answers none of them:
 *
 *   1. NATIVE WIDTH. `getEmbeddingTableSuffix` turns a declared dimension into
 *      a table name, so the number in `openrouter.json` picks which
 *      `embeddings_<n>` every read and write addresses. Get it wrong and the
 *      library reads as permanently empty and permanently pending at once
 *      (F-093). OpenRouter's `/models/:slug/endpoints` does NOT publish it --
 *      and its `supported_parameters` is visibly boilerplate (`temperature`,
 *      `top_k` on an embedding model), so it is not evidence either way.
 *
 *   2. MRL SUPPORT. `dimensions` is deliberately not plumbed into the app,
 *      because a truncated vector needs renormalising that `storeEmbeddings`
 *      does not do. That argument rests on truncations arriving NON-unit. If a
 *      model renormalises its own truncations, the argument does not hold for
 *      that model and the decision is worth revisiting -- for that model only.
 *
 *   3. NORMALISATION. Every one of the 31 `<=>` comparisons in this repo is
 *      cosine and magnitude-invariant, so a non-unit vector costs them nothing.
 *      The two places vectors are SUMMED are not: `buildWeightedAverageEmbedding`
 *      and the normalise-before-mean in `refreshCenteredEmbeddings`. Both
 *      already call `l2Normalize`, and this says whether that is live work or
 *      the identity for a given model. `pplx-embed-v1-4b`'s card says its
 *      output is unnormalised at its own native width; this checks rather than
 *      believes it.
 *
 * WHY EACH CONFIGURATION IS SENT TWICE. F-038 was written wrong twice from
 * single samples. One call per configuration cannot distinguish "these two
 * differ" from "this endpoint is nondeterministic", and OpenRouter routes each
 * call independently between upstreams that need not agree. So every
 * measurement here is repeated and the script says outright when a repeat
 * disagrees with itself -- which is a finding, not noise to average away.
 *
 * WHY `require_parameters` ON THE TRUNCATION CALL. Without it OpenRouter is
 * free to route to an upstream that ignores `dimensions`, and the reply comes
 * back at native width with no error -- indistinguishable from a model that
 * refuses to truncate. With it, a route that cannot honour the field fails
 * loudly instead.
 *
 * Writes nothing. Touches no embedding table. Reads the stored key, never an
 * argument, so no secret is typed or left in shell history.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\probe-embedding-shape.mjs aperture:/tmp/shape.mjs
 *   docker exec aperture node /tmp/shape.mjs
 *
 * Options:
 *   --models a,b,c   comma-separated OpenRouter slugs (default: the catalogue)
 *   --truncate N     dimension to request for the MRL check (default 768)
 *   --skip-truncate  native width and norm only, one call per model
 */

const CORE = '/app/packages/core/dist/index.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(name)

const DEFAULT_MODELS = [
  'google/gemini-embedding-2',
  'google/gemini-embedding-001',
  'qwen/qwen3-embedding-8b',
  'perplexity/pplx-embed-v1-4b',
]

const models = flag('--models', '')
  ? flag('--models', '').split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_MODELS
const truncateTo = Number(flag('--truncate', '768'))
const skipTruncate = has('--skip-truncate')

/**
 * A short but REAL document. A one-character input is cheapest and is what the
 * width question needs, but a degenerate input is a bad place to read a norm
 * from -- and the norm is two thirds of what this script is for.
 */
const INPUT =
  'Stalker. Directed by Andrei Tarkovsky. Genres: Science Fiction, Drama. ' +
  'A guide leads two men through a forbidden zone to a room said to grant wishes.'

const { getFunctionConfig, getSystemSetting } = await import(CORE)

// Mirrors withResolvedCredentials: a role may carry an inline key, but the
// settings UI writes the shared per-provider store, so checking only one of the
// two is how a key that is plainly visible in the UI reads as missing here.
async function openRouterKey() {
  const role = await getFunctionConfig('embeddings')
  if (role?.provider === 'openrouter' && role.apiKey) return role.apiKey

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

async function embed(model, { dimensions } = {}) {
  const body = { model, input: INPUT, encoding_format: 'float' }
  if (dimensions != null) {
    body.dimensions = dimensions
    // See the header: without this a route that ignores `dimensions` answers at
    // native width and looks identical to a model that cannot truncate.
    body.provider = { require_parameters: true }
  }
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  const vec = json?.data?.[0]?.embedding
  if (!Array.isArray(vec)) throw new Error(`no embedding in response: ${JSON.stringify(json).slice(0, 200)}`)
  return vec
}

const l2 = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const identical = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Cosine between the two repeats.
 *
 * Byte-equality alone is the wrong instrument and the qwen result is why: three
 * upstreams at different quantizations will never be byte-identical, but
 * neither will one upstream that batched differently. A bare "DISAGREED" cannot
 * tell those apart, and they mean opposite things -- 0.9999 is float noise that
 * changes no ranking, while 0.85 is two different spaces being written into one
 * set. So report the number, not the boolean.
 */
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

/** Two calls, so a disagreement is measured rather than silently halved. */
async function measure(model, opts) {
  const a = await embed(model, opts)
  const b = await embed(model, opts)
  const sameWidth = a.length === b.length
  return {
    dims: a.length,
    norm: l2(a),
    stable: identical(a, b),
    repeatCosine: sameWidth ? cosine(a, b) : null,
    dimsAgree: sameWidth,
  }
}

/**
 * What a repeat disagreement is worth worrying about.
 *
 * There is no measured threshold here and one is not invented: the two observed
 * populations are ~1.0 (Google, Perplexity: byte-identical) and whatever a
 * multi-upstream model does. The bands below only decide the wording, and the
 * cosine is always printed so the reader can disagree with them.
 */
function describeRepeat(m) {
  if (m.stable) return ''
  if (m.repeatCosine == null) return '   <-- REPEAT RETURNED A DIFFERENT WIDTH'
  const c = m.repeatCosine.toFixed(6)
  if (m.repeatCosine > 0.9999) return `   <-- not byte-identical, but cosine ${c}: float noise`
  return `   <-- REPEATS DIFFER, cosine ${c}: this set would be a MIXTURE of spaces`
}

/**
 * How many upstreams OpenRouter may route this model to, and at what
 * quantization. Unauthenticated and free.
 *
 * This is the RISK SIGNAL for the repeat check, not a verdict on it. Measured:
 * gemini-2 has four upstreams and returns byte-identical vectors anyway (they
 * are all Google), while qwen3-embedding-8b has three third-party hosts at
 * differing quantization and does not. So a count above one means "check the
 * repeat cosine before trusting this as one set", and nothing stronger.
 */
async function upstreams(model) {
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const eps = (await res.json())?.data?.endpoints
    if (!Array.isArray(eps)) return null
    return eps.map((e) => `${e.provider_name}${e.quantization ? `/${e.quantization}` : ''}`)
  } catch {
    return null
  }
}

const rows = []

for (const model of models) {
  process.stdout.write(`\n=== ${model} ===\n`)

  const hosts = await upstreams(model)
  if (hosts) {
    console.log(
      `  upstreams   : ${hosts.length} -- ${hosts.join(', ')}` +
        (hosts.length > 1 ? '   (routing may vary per call; see the repeat check)' : '')
    )
  }

  let native
  try {
    native = await measure(model, {})
    console.log(
      `  native      : ${native.dims} dims, L2 norm ${native.norm.toFixed(6)}` +
        describeRepeat(native)
    )
    rows.push({
      model,
      requested: null,
      returned: native.dims,
      norm: native.norm,
      note: native.stable ? '' : `repeat cos ${native.repeatCosine?.toFixed(6) ?? '?'}`,
    })
  } catch (err) {
    console.log(`  native      : FAILED -- ${err.message}`)
    rows.push({ model, requested: null, returned: null, norm: null, note: 'failed' })
    continue
  }

  if (skipTruncate) continue
  if (truncateTo >= native.dims) {
    console.log(`  truncated   : skipped (--truncate ${truncateTo} is not below native ${native.dims})`)
    continue
  }

  try {
    const cut = await measure(model, { dimensions: truncateTo })
    // Three outcomes, and they must not be conflated. Honoured: the model does
    // MRL. Native width back: the field was accepted and ignored, so a stored
    // "dimensions" setting would be a lie. Error: it refuses, which is honest.
    const verdict =
      cut.dims === truncateTo
        ? 'MRL honoured'
        : cut.dims === native.dims
          ? 'IGNORED (returned native width)'
          : `unexpected width ${cut.dims}`
    console.log(
      `  @${truncateTo} dims  : ${cut.dims} dims, L2 norm ${cut.norm.toFixed(6)}  -- ${verdict}` +
        describeRepeat(cut)
    )
    if (cut.dims === truncateTo) {
      // The question F-038's "dimensions is not plumbed" rests on. A truncation
      // arriving unit-length means THAT model renormalises its own; anything
      // else means the caller must, and storeEmbeddings does not.
      const unit = Math.abs(cut.norm - 1) < 1e-3
      console.log(
        `                : truncation is ${unit ? 'UNIT-LENGTH (model renormalises)' : 'NOT unit-length (caller must renormalise)'}`
      )
    }
    rows.push({ model, requested: truncateTo, returned: cut.dims, norm: cut.norm, note: verdict })
  } catch (err) {
    console.log(`  @${truncateTo} dims  : REFUSED -- ${err.message}`)
    rows.push({ model, requested: truncateTo, returned: null, norm: null, note: 'refused' })
  }
}

console.log('\n\n=== (model, requested_dims, returned_dims, norm) ===\n')
const pad = (s, n) => String(s).padEnd(n)
console.log(pad('model', 34), pad('requested', 10), pad('returned', 9), pad('norm', 10), 'note')
for (const r of rows) {
  console.log(
    pad(r.model, 34),
    pad(r.requested ?? '-', 10),
    pad(r.returned ?? '-', 9),
    pad(r.norm == null ? '-' : r.norm.toFixed(6), 10),
    r.note
  )
}
console.log(
  '\nA norm far from 1.000000 is not a defect -- cosine does not care. It matters\n' +
    'only where vectors are SUMMED (the taste centroid, and the mean the centring\n' +
    'job subtracts), and both of those already l2Normalize per item.\n'
)

process.exit(0)
