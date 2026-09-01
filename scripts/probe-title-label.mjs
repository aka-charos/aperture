/**
 * Does labelling the title reduce lexical attraction?
 *
 * THE QUESTION. `buildCanonicalText` pushes `movie.title` as the FIRST section,
 * bare and unlabelled, while every other field is tagged (`Genres: ...`,
 * `Directed by ...`, `"tagline"`). Measured across 18 seeds on the archived
 * evaluation, `gemini-embedding-2 ~semantic_similarity` returns a neighbour
 * sharing a title word with the seed in 10.0% of its top-10 slots, against
 * 2.8% for `gemini-embedding-001` -- *Alice In The Cities* pulls three
 * unrelated *Alice* films, *The Conversation* pulls Visconti's *Conversation
 * Piece* twice, *When Evil Lurks* pulls two *Evil Dead*s and two *Speak No
 * Evil*s.
 *
 * A label is the cheapest candidate fix. Committing it costs a
 * CANONICAL_TEXT_VERSION bump, which marks all four stored sets stale -- and
 * only the ACTIVE set gets rebuilt, so the four-way comparison then reads v4
 * against three sets at v3 and can no longer separate the label from the model.
 * Re-embedding all four to keep it honest is ~50,000 documents. This script is
 * the thing to run before paying that.
 *
 * WHY THIS MEASURES RANKS, NOT COSINES. `compare-embedding-modes.mjs` answers
 * "are these different spaces". That is the wrong instrument here: a label
 * moves every vector a little, so it is guaranteed to register as a different
 * space, and that fact says nothing about whether the intruders got demoted.
 * The only thing that matters is whether *Conversation Piece* falls below *The
 * Parallax View*. So this ranks a pool and reports movement.
 *
 * WHY A SMALL POOL IS VALID. Ranking 20 candidates is not ranking 12,589, and
 * an absolute rank here is meaningless. But the question is RELATIVE -- does a
 * known lexical intruder outrank a known correct neighbour for the same seed --
 * and the answer to that is unchanged by the titles left out, because every
 * omitted title would sit somewhere in between without reordering the pair.
 *
 * WHY STRING SURGERY RATHER THAN A SECOND BUILDER. The canonical text begins
 * with the bare title, so the labelled variant is exactly the same document
 * with `Title: ` inserted at offset 0. Forking `buildCanonicalText` to test it
 * would mean the thing measured here and the thing shipped later are two
 * different functions that have to be kept in step by hand.
 *
 * Writes nothing. Touches no embedding table. Reads the stored key.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\probe-title-label.mjs aperture:/tmp/probe.mjs
 *   docker exec aperture node /tmp/probe.mjs
 *
 * Options:
 *   --model SLUG   OpenRouter model (default google/gemini-embedding-2)
 *   --prefix off   drop the task prefix, to separate the label's effect from
 *                  the prefix's. Default is the shipped semantic prefix.
 */

const CORE = '/app/packages/core/dist/index.js'
const SEMANTIC_PREFIX = 'task: sentence similarity | query: '

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const model = flag('--model', 'google/gemini-embedding-2')

/**
 * Google documents eight task prefixes for gemini-embedding-2. These are the
 * ones worth comparing here; the two retrieval forms are omitted for the reason
 * given on `inputTypePrefixes` in ai-capabilities/types.ts (they are the halves
 * of an ASYMMETRIC pair, and this app has one index).
 *
 * An unrecognised value is passed through verbatim, which is useful for trying
 * a documented string this map does not carry -- but note that a prefix is a
 * TASK TOKEN THE MODEL WAS TRAINED ON, not an instruction. Inventing wording
 * ("ignore titles") puts out-of-distribution text at the head of every document
 * and the model embeds it rather than obeying it.
 */
const PREFIXES = {
  on: SEMANTIC_PREFIX,
  semantic: SEMANTIC_PREFIX,
  off: '',
  clustering: 'task: clustering | query: ',
  classification: 'task: classification | query: ',
  qa: 'task: question answering | query: ',
}
const prefixArg = flag('--prefix', 'on')
const prefix = prefixArg in PREFIXES ? PREFIXES[prefixArg] : prefixArg

// `query` resolves to { rows, rowCount }, NOT an array -- reading it as one
// makes every lookup return undefined, which this script reported as "not in
// library" for titles that were plainly there. `queryOne` returns the row.
const { getSystemSetting, getFunctionConfig, queryOne, buildCanonicalText } = await import(CORE)

/**
 * The cases, taken from the archived neighbour dump rather than invented.
 *
 * `intruders` share a title word with the seed and are thematically wrong.
 * `anchors` are correct neighbours the same run already found -- several come
 * from the 001 column, which is the point: they are reachable titles that the
 * gemini-2 space ranked below a pun.
 *
 * A `year` of null means "whichever one this library holds"; it is set only
 * where the library actually carries two films of the same name.
 */
const CASES = [
  {
    seed: { title: 'Alice In The Cities', year: 1974 },
    intruders: [
      { title: "Alice Doesn't Live Here Anymore", year: 1974 },
      { title: 'Alice', year: 1990 },
      { title: 'Alice', year: 1988 },
    ],
    anchors: [
      { title: 'Kings Of The Road', year: 1976 },
      { title: 'Wrong Move', year: 1975 },
      { title: 'Paris, Texas', year: 1984 },
      { title: 'Wings Of Desire', year: 1988 },
      { title: 'Ali: Fear Eats The Soul', year: 1974 },
    ],
  },
  {
    seed: { title: 'The Conversation', year: 1974 },
    intruders: [
      { title: 'Conversation Piece', year: 1974 },
      { title: 'Conversation Piece', year: 1977 },
    ],
    anchors: [
      { title: 'The Parallax View', year: 1974 },
      { title: 'Blow Out', year: 1981 },
      { title: "All the President's Men", year: 1976 },
      { title: 'Marathon Man', year: 1976 },
    ],
  },
  {
    seed: { title: 'When Evil Lurks', year: 2023 },
    intruders: [
      { title: 'Evil Dead', year: 2013 },
      { title: 'Evil Dead Rise', year: 2023 },
      { title: 'Speak No Evil', year: 2022 },
      { title: 'Speak No Evil', year: 2024 },
    ],
    anchors: [
      { title: 'Terrified', year: 2018 },
      { title: 'Virus:32', year: 2022 },
      { title: 'To Kill The Beast', year: 2022 },
      { title: 'Resurrection', year: 2016 },
    ],
  },
  {
    seed: { title: 'The Worst Person In The World', year: 2021 },
    intruders: [
      { title: 'The Night Eats the World', year: null },
      { title: 'The World to Come', year: null },
    ],
    anchors: [
      { title: 'Reprise', year: null },
      { title: 'Oslo, August 31st', year: null },
      { title: 'Julie Keeps Quiet', year: null },
    ],
  },
]

// ---------------------------------------------------------------------------
// The stored key. Mirrors withResolvedCredentials: a role may carry an inline
// key, but the settings UI writes the shared per-provider store, so checking
// only one of the two is how a key that is plainly visible in the UI reads as
// missing here.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Real documents
// ---------------------------------------------------------------------------

const COLUMNS = `id, title, year, genres, overview, tagline, directors,
  actors::text, studios::text, content_rating, tags, production_countries,
  awards, keywords, collection_name, composers, cinematographers, languages,
  awards_summary, plot_full`

const toMovie = (row) => ({
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

/**
 * Title match through unaccent(), year optional -- see helpers/titleMatch.
 *
 * Exact first, then a prefix match, because the dump renders a title the way
 * the row stores it but punctuation still differs (a curly apostrophe in
 * "The Teachers' Lounge", a colon this library writes and the CSV does not).
 * The fallback PRINTS what it matched: a prefix match returning one row is how
 * "The Three Musketeers" silently becomes the earliest of four, and a wrong
 * match here is worse than a miss, because a miss is at least reported.
 */
async function findOne({ title, year }) {
  const exact = await queryOne(
    `SELECT ${COLUMNS} FROM movies
      WHERE unaccent(lower(title)) = unaccent(lower($1))
        AND ($2::int IS NULL OR year = $2)
      ORDER BY year NULLS LAST LIMIT 1`,
    [title, year]
  )
  if (exact) return toMovie(exact)

  const loose = await queryOne(
    `SELECT ${COLUMNS} FROM movies
      WHERE unaccent(lower(title)) LIKE unaccent(lower($1)) || '%'
        AND ($2::int IS NULL OR year = $2)
      ORDER BY length(title), year NULLS LAST LIMIT 1`,
    [title, year]
  )
  if (!loose) return null
  console.log(`  (matched "${title}" -> "${loose.title}" ${loose.year})`)
  return toMovie(loose)
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

async function embed(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: `${prefix}${text}`, encoding_format: 'float' }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  return json.data[0].embedding
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

/**
 * The treatments.
 *
 * `bare` is what ships today. `labelled` tags the leading title -- MEASURED
 * 2026-09-01 and it does NOTHING: 25 of 26 rankings identical and separation
 * unchanged to two decimals, so the model is not reading "first bare string"
 * as a role it can be talked out of. Kept as the control that shows it.
 *
 * `stripped` removes the title outright. It is the only text-level change left
 * that actually deletes the tokens rather than re-framing them, and after the
 * label result it is the one worth knowing. It is NOT a shipping candidate on
 * its own -- a title carries real signal for sequels and for the films whose
 * genre is in their name -- but if it does not close the gap either, then the
 * attraction is not coming from the title field at all and no edit to
 * `buildCanonicalText` will fix it.
 *
 * Sections join with '. ', so the document opens `${title}. ${rest}`.
 */
const MODES = ['bare', 'labelled', 'stripped', 'tail']

function treat(text, movie, mode) {
  if (mode === 'labelled') return `Title: ${text}`
  const head = `${movie.title}. `
  // Only when it really is the opening, so a builder change turns these into an
  // obvious no-op rather than a silent truncation of some other field.
  if (!text.startsWith(head)) return text
  if (mode === 'stripped') return text.slice(head.length)
  if (mode === 'tail') return `${text.slice(head.length)}. ${movie.title}`
  return text
}

// ---------------------------------------------------------------------------

// Print the literal string, not a flag name: which prefix produced a number is
// the whole provenance of that number.
console.log(`model ${model}   prefix ${prefix ? JSON.stringify(prefix) : '(none)'}`)
console.log('Ranking each pool under both treatments. Lower rank = closer.\n')

const totals = Object.fromEntries(MODES.map((m) => [m, { intruder: [], anchor: [] }]))

for (const c of CASES) {
  const seed = await findOne(c.seed)
  if (!seed) {
    console.log(`SKIP ${c.seed.title} -- not in library\n`)
    continue
  }

  const pool = []
  for (const [kind, list] of [
    ['intruder', c.intruders],
    ['anchor', c.anchors],
  ]) {
    for (const spec of list) {
      const m = await findOne(spec)
      if (m) pool.push({ kind, movie: m })
      else console.log(`  (missing: ${spec.title}${spec.year ? ` ${spec.year}` : ''})`)
    }
  }
  if (pool.length < 3) {
    console.log(`SKIP ${c.seed.title} -- pool too small\n`)
    continue
  }

  console.log(`### ${seed.title} (${seed.year})`)
  const ranked = {}
  for (const mode of MODES) {
    const sv = await embed(treat(buildCanonicalText(seed), seed, mode))
    const scored = []
    for (const p of pool) {
      const v = await embed(treat(buildCanonicalText(p.movie), p.movie, mode))
      scored.push({ ...p, cos: cosine(sv, v) })
    }
    scored.sort((a, b) => b.cos - a.cos)
    scored.forEach((s, i) => {
      s.rank = i + 1
      totals[mode][s.kind].push(i + 1)
    })
    ranked[mode] = scored
  }

  const rankOf = Object.fromEntries(
    MODES.map((m) => [m, Object.fromEntries(ranked[m].map((s) => [s.movie.id, s.rank]))])
  )
  console.log(
    `  ${'candidate'.padEnd(36)} ${'kind'.padEnd(9)}` +
      MODES.map((m) => m.padStart(10)).join('')
  )
  // Ordered by the shipping treatment, so every column reads as movement away
  // from what the library actually holds today.
  for (const s of ranked.bare) {
    console.log(
      `  ${`${s.movie.title} (${s.movie.year})`.slice(0, 35).padEnd(36)} ` +
        `${s.kind.padEnd(9)}` +
        MODES.map((m) => String(rankOf[m][s.movie.id]).padStart(10)).join('')
    )
  }
  console.log()
}

// Every case skipping is a bug in this script far more often than it is a
// library that holds none of them -- these titles were READ OUT of that
// library's own neighbour dump. Say so, rather than printing a table of NaN
// that looks like a measurement.
if (totals.bare.intruder.length === 0) {
  console.error(
    'No case produced a ranking. The cases come from this library\'s archived\n' +
      'neighbour dump, so "not in library" for all of them means the lookup is\n' +
      'broken, not that the films are absent. Check findOne() before reading\n' +
      'anything else here.'
  )
  process.exit(1)
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
console.log('=== mean rank across all cases (lower = closer to the seed) ===')
for (const mode of MODES) {
  const i = mean(totals[mode].intruder)
  const a = mean(totals[mode].anchor)
  console.log(
    `  ${mode.padEnd(9)} intruders ${i.toFixed(2)}   anchors ${a.toFixed(2)}   ` +
      `separation ${(i - a).toFixed(2)}`
  )
}
console.log(
  '\nSeparation is the number to read: intruder rank minus anchor rank. It should\n' +
    'be POSITIVE -- intruders further from the seed than the correct neighbours --\n' +
    'and a treatment helps only if it GROWS. Measured negative on the shipping\n' +
    'document, which is the artifact stated as a number.\n' +
    '\n' +
    'A change under about half a rank is noise at this pool size. One call per\n' +
    'configuration cannot tell "these differ" from "this endpoint is not\n' +
    'deterministic", so rerun before believing a small move.'
)
process.exit(0)
