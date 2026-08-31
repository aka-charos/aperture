/**
 * Compare embedding configurations head to head, on this library's real
 * documents, using the stored OpenRouter key.
 *
 * THE QUESTION THIS ANSWERS. Four configurations are candidates for the next
 * full pass, and they are not obviously different from outside:
 *
 *   001-default    gemini-embedding-001, no input_type   (what is stored today)
 *   001-semantic   gemini-embedding-001 + input_type: semantic_similarity
 *   gemini2-bare   gemini-embedding-2, no conditioning
 *   gemini2-prefix gemini-embedding-2 + "task: sentence similarity | query: "
 *
 * A full pass costs about an hour and a re-centring and a taste-profile
 * rebuild. This costs one API call per document per variant and says, before
 * any of that, which of them are actually distinct spaces and which are the
 * same vector under two names — because a parameter a model ignores returns the
 * byte-identical vector to sending nothing, and that is indistinguishable from
 * "the default is already what I asked for" unless you compare them.
 *
 * WHY REAL DOCUMENTS. A hand-written "Title / Director / Plot" snippet is not
 * what this app embeds. The real canonical text is fifteen fields and, on this
 * library, runs from ~350 to ~2,200 characters with an IMDb synopsis in the
 * middle of it. Conditioning a 350-character document and a 2,200-character one
 * are not the same operation, so the seeds are drawn from
 * `evaluation_seed_titles` — the same titles whose neighbour dumps decide this.
 *
 * It reads the stored credential, writes nothing, and touches no embedding
 * table. It does NOT read the embeddings-role model setting: the whole point is
 * to compare configurations other than the one currently selected.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\compare-embedding-modes.mjs aperture:/tmp/compare.mjs
 *   docker exec aperture node /tmp/compare.mjs
 *
 * Options:
 *   --docs N     how many seed documents to test (default 3)
 *   --repeat N   embed each variant N times and report hash stability. Use
 *                this when a pair reads IDENTICAL on one document and not on
 *                another: a variant whose OWN hash changes between identical
 *                requests is being routed to different upstreams, and no
 *                per-document reading of the matrix means anything until that
 *                is settled.
 *   --pin SLUG   pin OpenRouter routing to one upstream and disable fallbacks
 *                (e.g. google-vertex, google-ai-studio).
 *   --reverse    run the variants in reverse order. If a pair's result CHANGES
 *                when the order does, the endpoint is caching on (model, input)
 *                without input_type, and the second call is being served the
 *                first one's vector. That is an artifact of asking, not a fact
 *                about the model — and it is indistinguishable from "the
 *                parameter was ignored" from a single ordering.
 *   --show-request  print the exact JSON body sent for each call, minus the
 *                key. The only way to confirm input_type is actually on the
 *                wire rather than taking this script's word for it.
 *   --series     use series seeds instead of movies
 *   --json PATH  also write the full result, vectors excluded, as JSON
 */
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const CORE = '/app/packages/core/dist/index.js'
const EVAL = '/app/packages/core/dist/evaluation/index.js'
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const docCount = Number(flag('--docs', '3'))
const mediaType = argv.includes('--series') ? 'series' : 'movie'
const jsonPath = flag('--json', null)
const repeat = Math.max(1, Number(flag('--repeat', '1')))
const pin = flag('--pin', null)
const reverse = argv.includes('--reverse')
const showRequest = argv.includes('--show-request')

const SEMANTIC_PREFIX = 'task: sentence similarity | query: '

/**
 * The four candidates.
 *
 * `prefix` conditions the TEXT; `inputType` conditions the REQUEST. They are
 * different mechanisms and gemini-2 reads only the first, which is the fact
 * this whole comparison exists to make visible rather than assumed.
 */
const VARIANTS = [
  { name: '001-default', model: 'google/gemini-embedding-001' },
  {
    name: '001-semantic',
    model: 'google/gemini-embedding-001',
    inputType: 'semantic_similarity',
  },
  { name: 'gemini2-bare', model: 'google/gemini-embedding-2' },
  { name: 'gemini2-prefix', model: 'google/gemini-embedding-2', prefix: SEMANTIC_PREFIX },
]

const { getSystemSetting, getFunctionConfig, query, buildCanonicalText, buildSeriesCanonicalText } =
  await import(CORE)
const { resolveSeedIds, popularSeedIds } = await import(EVAL)

// ---------------------------------------------------------------------------
// The stored key
// ---------------------------------------------------------------------------

// Mirrors withResolvedCredentials: a role may carry an inline key, but the
// settings UI writes to the shared per-provider store, so that is usually where
// it actually lives. Checking only one of the two is how a key that is plainly
// visible in the UI reads as missing here.
async function openRouterKey() {
  const role = await getFunctionConfig('embeddings')
  if (role?.provider === 'openrouter' && role.apiKey) return role.apiKey

  const raw = await getSystemSetting('ai_provider_credentials')
  if (raw) {
    try {
      const creds = JSON.parse(raw)
      if (creds.openrouter?.apiKey) return creds.openrouter.apiKey
    } catch {
      // fall through to the error below; a corrupt blob is not a missing key
      console.error('warning: ai_provider_credentials did not parse')
    }
  }
  return null
}

const apiKey = await openRouterKey()
if (!apiKey) {
  console.error(
    'No OpenRouter key found. Checked the embeddings role and the shared\n' +
      'ai_provider_credentials store. Configure it in Settings > AI first.'
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Real documents
// ---------------------------------------------------------------------------

const setting = await getSystemSetting('evaluation_seed_titles')
const seedTitles = (setting ?? '')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)

let ids
if (seedTitles.length > 0) {
  const resolved = await resolveSeedIds(mediaType, seedTitles)
  const missing = resolved.filter((r) => !r.id).map((r) => r.input)
  if (missing.length > 0) console.log('seeds not found:', missing.join(', '))
  ids = resolved.filter((r) => r.id).map((r) => r.id)
} else {
  ids = await popularSeedIds(mediaType, docCount)
}

if (ids.length === 0) {
  console.error('No seed titles resolved; nothing to compare.')
  process.exit(1)
}

// Deliberately spread across the length range rather than taking the first N:
// a 357-character document and a 2,238-character one are not the same test of
// a prefix, and the short ones are where conditioning weighs most.
const MOVIE_COLUMNS = `id, title, year, genres, overview, tagline, directors,
  actors::text, studios::text, content_rating, tags, production_countries,
  awards, keywords, collection_name, composers, cinematographers, languages,
  awards_summary, plot_full`
const SERIES_COLUMNS = `id, title, year, end_year, genres, overview, tagline,
  status, network, directors, actors::text, studios::text, content_rating, tags,
  production_countries, awards, total_seasons, total_episodes, keywords,
  languages, awards_summary, plot_full`

const rows = (
  await query(
    mediaType === 'movie'
      ? `SELECT ${MOVIE_COLUMNS} FROM movies WHERE id = ANY($1)`
      : `SELECT ${SERIES_COLUMNS} FROM series WHERE id = ANY($1)`,
    [ids]
  )
).rows

const toDoc = (row) =>
  mediaType === 'movie'
    ? buildCanonicalText({
        id: row.id,
        title: row.title,
        year: row.year,
        genres: row.genres,
        overview: row.overview,
        tagline: row.tagline,
        directors: row.directors,
        actors: row.actors ? JSON.parse(row.actors) : null,
        studios: row.studios ? JSON.parse(row.studios) : null,
        contentRating: row.content_rating,
        tags: row.tags,
        productionCountries: row.production_countries,
        awards: row.awards,
        keywords: row.keywords,
        collectionName: row.collection_name,
        composers: row.composers,
        cinematographers: row.cinematographers,
        languages: row.languages,
        awardsSummary: row.awards_summary,
        plotFull: row.plot_full,
      })
    : buildSeriesCanonicalText({
        id: row.id,
        title: row.title,
        year: row.year,
        endYear: row.end_year,
        genres: row.genres,
        overview: row.overview,
        tagline: row.tagline,
        status: row.status,
        network: row.network,
        directors: row.directors,
        actors: row.actors ? JSON.parse(row.actors) : null,
        studios: row.studios ? JSON.parse(row.studios) : null,
        contentRating: row.content_rating,
        tags: row.tags,
        productionCountries: row.production_countries,
        awards: row.awards,
        totalSeasons: row.total_seasons,
        totalEpisodes: row.total_episodes,
        keywords: row.keywords,
        languages: row.languages,
        awardsSummary: row.awards_summary,
        plotFull: row.plot_full,
      })

const docs = rows
  .map((row) => ({ title: row.title, year: row.year, text: toDoc(row) }))
  .sort((a, b) => a.text.length - b.text.length)

// Shortest, median, longest — then fill inward. Length is the axis that matters.
const picked = []
if (docs.length > 0) picked.push(docs[0])
if (docs.length > 2 && docCount > 2) picked.push(docs[Math.floor(docs.length / 2)])
if (docs.length > 1 && docCount > 1) picked.push(docs[docs.length - 1])
for (const d of docs) {
  if (picked.length >= docCount) break
  if (!picked.includes(d)) picked.push(d)
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

async function embed(variant, text) {
  const body = {
    model: variant.model,
    input: variant.prefix ? `${variant.prefix}${text}` : text,
    encoding_format: 'float',
  }
  if (variant.inputType) body.input_type = variant.inputType
  // Unpinned, OpenRouter may serve one model from several upstreams, and they
  // need not honour the same request fields -- which shows up as a parameter
  // that works on one call and is ignored on the next.
  if (pin) body.provider = { only: [pin], allow_fallbacks: false }

  if (showRequest) {
    // Truncated input, full everything else: what matters here is whether
    // input_type is present, not re-reading the document.
    const shown = { ...body, input: `${body.input.slice(0, 60)}… (${body.input.length} chars)` }
    console.log('    -> POST', JSON.stringify(shown))
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`${variant.name}: HTTP ${res.status} ${detail.slice(0, 300)}`)
  }

  const json = await res.json()
  const vector = json?.data?.[0]?.embedding
  if (!Array.isArray(vector)) {
    throw new Error(`${variant.name}: no embedding in response`)
  }
  return vector
}

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

const sha = (v) => createHash('sha256').update(Buffer.from(new Float32Array(v).buffer)).digest('hex')

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`Comparing ${VARIANTS.length} configurations on ${picked.length} real document(s).`)
if (repeat > 1) console.log(`Each variant embedded ${repeat}x to check hash stability.`)
if (pin) console.log(`Routing pinned to "${pin}", fallbacks disabled.`)
if (reverse) console.log('Variant order REVERSED (cache-ordering check).')
console.log(`Seeds from ${seedTitles.length > 0 ? 'evaluation_seed_titles' : 'most-watched fallback'}.`)
console.log()

const report = []

for (const doc of picked) {
  console.log('='.repeat(72))
  console.log(`${doc.title}${doc.year ? ` (${doc.year})` : ''} — ${doc.text.length} chars`)
  console.log('='.repeat(72))

  const vectors = {}
  const order = reverse ? [...VARIANTS].reverse() : VARIANTS
  for (const variant of order) {
    try {
      // Repeated calls are byte-identical from a deterministic endpoint. When
      // they are not, the variant is being answered by more than one upstream
      // and every cosine below it is measuring routing rather than mode.
      const runs = []
      for (let r = 0; r < repeat; r++) runs.push(await embed(variant, doc.text))
      const hashes = runs.map(sha)
      const distinct = new Set(hashes)
      vectors[variant.name] = runs[0]

      const stability =
        repeat === 1
          ? ''
          : distinct.size === 1
            ? `  stable over ${repeat}`
            : `  UNSTABLE: ${distinct.size} distinct vectors over ${repeat} identical requests`
      console.log(
        `  ${variant.name.padEnd(15)} dim=${runs[0].length}  sha256=${hashes[0].slice(0, 16)}…${stability}`
      )
      if (distinct.size > 1) {
        for (const h of distinct) console.log(`      variant hash: ${h.slice(0, 32)}…`)
      }
    } catch (err) {
      console.log(`  ${variant.name.padEnd(15)} FAILED: ${err.message}`)
    }
  }

  const names = VARIANTS.map((v) => v.name).filter((n) => n in vectors)
  console.log()
  console.log('  pairwise cosine (1.000000 = same vector, so the difference is a no-op):')
  const pairs = []
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]
      const b = names[j]
      if (vectors[a].length !== vectors[b].length) {
        console.log(`    ${a} vs ${b}: different dimensions, not comparable`)
        continue
      }
      const c = cosine(vectors[a], vectors[b])
      const identical = sha(vectors[a]) === sha(vectors[b])
      console.log(
        `    ${(a + ' vs ' + b).padEnd(34)} ${c.toFixed(6)}${identical ? '   IDENTICAL' : ''}`
      )
      pairs.push({ a, b, cosine: c, identical })
    }
  }
  console.log()

  report.push({
    title: doc.title,
    year: doc.year,
    chars: doc.text.length,
    document: doc.text,
    hashes: Object.fromEntries(names.map((n) => [n, sha(vectors[n])])),
    dimensions: Object.fromEntries(names.map((n) => [n, vectors[n].length])),
    pairs,
  })
}

console.log('How to read this:')
console.log('  IDENTICAL  the two configurations produce the same vector, so whatever')
console.log('             distinguishes them is being ignored by that model.')
console.log('  ~0.99      a real but small difference.')
console.log('  <0.90      a genuinely different space — different neighbours, and a')
console.log('             taste centroid built in one is meaningless against the other.')
console.log()
console.log('Only configurations that differ are worth a full embedding pass.')

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nFull report written to ${jsonPath}`)
}

process.exit(0)
