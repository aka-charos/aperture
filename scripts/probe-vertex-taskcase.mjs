/**
 * Why does the JOB get a 400 from google-vertex when the PROBE got a 200?
 *
 * Vertex answered:
 *   "semantic_similarity cannot be parsed as a valid embedding task type.
 *    Valid task types: [... SEMANTIC_SIMILARITY]"
 *
 * so it is rejecting the SPELLING, not the mode. But `compare-embedding-modes`
 * sent that exact lowercase string pinned to google-vertex and got a 200 back
 * with a genuinely different vector (cosine 0.841 from unmoded). Both cannot be
 * the whole story, and two things differ between the two call sites:
 *
 *   CASE     the app sends OpenRouter's vocabulary verbatim; Google's native
 *            enum is upper-case, and `googleTaskTypeFor` already maps to it for
 *            the native provider. If OpenRouter forwards the field untouched,
 *            the correct spelling is the UPSTREAM's, not OpenRouter's.
 *   SHAPE    the probe sent `input` as one string; `embedMany` sends an array
 *            of 25. A different Vertex method may be behind each.
 *
 * So: both, crossed. Four requests settle it and no argument does.
 *
 * A 200 is not on its own a pass. A mode that is ACCEPTED and then IGNORED
 * returns the unmoded vector, which is the failure that looks most like
 * success -- so every variant is compared against a no-mode baseline and the
 * cosine is printed. Identical to baseline means ignored, whatever the status.
 *
 *   docker cp scripts\probe-vertex-taskcase.mjs aperture:/tmp/probe.mjs
 *   docker exec aperture node /tmp/probe.mjs
 */
import { createHash } from 'node:crypto'

const CORE = '/app/packages/core/dist/index.js'
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const MODEL = 'google/gemini-embedding-001'
const PIN = 'google-vertex'

const DOCS = [
  'A drifting security guard takes a night job at a derelict hotel and starts seeing the previous tenant.',
  'Two rival chefs in postwar Naples inherit the same failing trattoria and refuse to sell.',
  'A documentary crew follows a retired stunt driver rebuilding the car that nearly killed him.',
]

const { getSystemSetting, getFunctionConfig } = await import(CORE)

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
  console.error('No OpenRouter key found in the embeddings role or the shared store.')
  process.exit(1)
}

/** float32 LE, so the hash is comparable with the numpy probe. */
function sha(vec) {
  const buf = Buffer.alloc(vec.length * 4)
  vec.forEach((v, i) => buf.writeFloatLE(v, i * 4))
  return createHash('sha256').update(buf).digest('hex').slice(0, 12)
}

function cosine(a, b) {
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

async function call({ inputType, batched }) {
  const body = {
    model: MODEL,
    input: batched ? DOCS : DOCS[0],
    encoding_format: 'float',
    provider: { only: [PIN], allow_fallbacks: false },
  }
  if (inputType) body.input_type = inputType

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 200) }

  const json = JSON.parse(text)
  // Batched responses are not guaranteed to arrive in request order.
  const sorted = [...json.data].sort((a, b) => a.index - b.index)
  return { ok: true, status: res.status, vectors: sorted.map((d) => d.embedding) }
}

console.log(`model    ${MODEL}`)
console.log(`pinned   ${PIN} (allow_fallbacks: false)`)
console.log(`docs     ${DOCS.length}, first is ${DOCS[0].length} chars\n`)

console.log('Baseline: no input_type ...')
const single = await call({ batched: false })
const batch = await call({ batched: true })
if (!single.ok || !batch.ok) {
  console.error('Baseline itself failed, so nothing below is interpretable:')
  console.error('  single:', single.ok ? 'ok' : `${single.status} ${single.detail}`)
  console.error('  batch :', batch.ok ? 'ok' : `${batch.status} ${batch.detail}`)
  process.exit(1)
}
console.log(`  single  ${sha(single.vectors[0])}`)
console.log(`  batched ${sha(batch.vectors[0])}`)
console.log(
  `  same vector both shapes: ${sha(single.vectors[0]) === sha(batch.vectors[0]) ? 'YES' : 'NO'}\n`
)

const CASES = [
  { label: 'lowercase  semantic_similarity', inputType: 'semantic_similarity' },
  { label: 'UPPERCASE  SEMANTIC_SIMILARITY', inputType: 'SEMANTIC_SIMILARITY' },
  // The other two modes, in the spelling the upstream actually accepts.
  // The catalog claims these are byte-identical to the default -- but that was
  // measured lower-case on the string path, which normalises, so it may have
  // been measuring DROPPED rather than same-space. Asked properly here.
  { label: 'UPPERCASE  RETRIEVAL_QUERY     ', inputType: 'RETRIEVAL_QUERY' },
  { label: 'UPPERCASE  RETRIEVAL_DOCUMENT  ', inputType: 'RETRIEVAL_DOCUMENT' },
]

for (const shape of [false, true]) {
  const baseVec = (shape ? batch : single).vectors[0]
  console.log(shape ? 'ARRAY input (what embedMany sends)' : 'STRING input (what the probe sent)')
  for (const c of CASES) {
    const r = await call({ inputType: c.inputType, batched: shape })
    if (!r.ok) {
      console.log(`  ${c.label}  HTTP ${r.status}`)
      console.log(`      ${r.detail.replace(/\s+/g, ' ')}`)
      continue
    }
    const v = r.vectors[0]
    const cos = cosine(baseVec, v)
    const ignored = sha(v) === sha(baseVec)
    console.log(
      `  ${c.label}  200  ${sha(v)}  cos-vs-baseline ${cos.toFixed(4)}  ${
        ignored ? '<- IGNORED (identical to baseline)' : '<- honoured'
      }`
    )
  }
  console.log('')
}

console.log('Read it as: a 400 says the spelling is wrong for this upstream.')
console.log('A 200 whose vector equals the baseline says the field was accepted')
console.log('and thrown away, which is the one that would silently ship.')
process.exit(0)
