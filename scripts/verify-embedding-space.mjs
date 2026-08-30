/**
 * Show exactly what Aperture sends to the embedding model, and what comes back.
 *
 * WHY THIS EXISTS. A retrieval mode reaches gemini-embedding-2 as a prefix on
 * the TEXT, not as a request parameter — so "is the mode being applied?" is a
 * question about the bytes going out, and a wrong answer is invisible: the
 * vector still has the right width, a unit norm and plausible neighbours. It
 * just sits in a different space from every row beside it.
 *
 * WHY IT READS REAL FILMS RATHER THAN A SAMPLE DOCUMENT. A hand-written
 * "Title / Director / Plot" snippet is not what this app embeds. The real
 * canonical text runs to fifteen fields and, on this library, a median of ~900
 * characters with an IMDb synopsis in the middle of it — a different length, a
 * different proper-noun density, and a different thing for a task prefix to sit
 * in front of. It pulls the evaluation seed titles specifically, so the
 * document being checked is one whose neighbour dump you will actually read.
 *
 * It writes each document to a file too, so the same bytes can be fed to a
 * provider-side probe. Matching sha256 between the two then proves the whole
 * chain — settings row, invocation, prefix, provider, model — end to end,
 * which is the only version of this check worth the round trip.
 *
 * Reads the LIVE embeddings-role config, so point that at the model and mode
 * you are about to run BEFORE using this. It embeds nothing into the database
 * and writes no vectors; it costs one API call per seed.
 *
 * Usage, from the Docker host:
 *
 *   docker cp scripts\verify-embedding-space.mjs aperture:/tmp/verify.mjs
 *   docker exec aperture node /tmp/verify.mjs
 *
 * Then, to read a document back out for a provider-side probe:
 *
 *   docker cp aperture:/tmp/embedding-check/seed-1.txt .
 *
 * Options:
 *   --limit N     how many seeds to embed (default 2; 0 embeds none, just dumps)
 *   --series      use series seeds instead of movies
 *   --out DIR     where to write the documents (default /tmp/embedding-check)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const CORE = '/app/packages/core/dist/index.js'
// Seed resolution is evaluation-internal and deliberately not in the root
// barrel; a diagnostic is not a reason to widen the public surface.
const EVAL = '/app/packages/core/dist/evaluation/index.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const limit = Number(flag('--limit', '2'))
const mediaType = argv.includes('--series') ? 'series' : 'movie'
const outDir = flag('--out', '/tmp/embedding-check')

const {
  getEmbeddingInvocation,
  getSystemSetting,
  query,
  buildCanonicalText,
  buildSeriesCanonicalText,
} = await import(CORE)
const { resolveSeedIds, popularSeedIds } = await import(EVAL)

// ---------------------------------------------------------------------------
// Which titles
// ---------------------------------------------------------------------------

// Newline-separated, matching how the evaluate-recommender job reads it.
const setting = await getSystemSetting('evaluation_seed_titles')
const seedTitles = (setting ?? '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

let ids
if (seedTitles.length > 0) {
  const resolved = await resolveSeedIds(mediaType, seedTitles)
  const missing = resolved.filter((r) => !r.id).map((r) => r.input)
  if (missing.length > 0) console.log('seeds not found:', missing.join(', '))
  ids = resolved.filter((r) => r.id).map((r) => r.id)
  console.log(`seeds: ${ids.length} of ${seedTitles.length} configured titles resolved`)
} else {
  // Same fallback the job uses, so this never silently checks nothing.
  ids = await popularSeedIds(mediaType, 5)
  console.log(`seeds: none configured, using ${ids.length} most-watched titles`)
}

if (ids.length === 0) {
  console.error('No seed titles resolved; nothing to check.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The real canonical text for each
// ---------------------------------------------------------------------------

// The same column list the embedding job selects, so the document produced here
// is byte-identical to the one a real pass would produce for this title.
const rows =
  mediaType === 'movie'
    ? (
        await query(
          `SELECT id, title, year, genres, overview, tagline, directors,
                  actors::text, studios::text, content_rating, tags,
                  production_countries, awards, keywords, collection_name,
                  composers, cinematographers, languages, awards_summary, plot_full
             FROM movies WHERE id = ANY($1)`,
          [ids]
        )
      ).rows
    : (
        await query(
          `SELECT id, title, year, end_year, genres, overview, tagline, status,
                  network, directors, actors::text, studios::text, content_rating,
                  tags, production_countries, awards, total_seasons, total_episodes,
                  keywords, languages, awards_summary, plot_full
             FROM series WHERE id = ANY($1)`,
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

// ---------------------------------------------------------------------------
// Configuration in force
// ---------------------------------------------------------------------------

const inv = await getEmbeddingInvocation()

console.log()
console.log('--- configuration ---')
console.log('set id     :', inv.setId)
console.log('mode       :', inv.inputType ?? '(none)')
console.log('delivered  :', inv.inputTypeMechanism)
console.log()

mkdirSync(outDir, { recursive: true })

// ---------------------------------------------------------------------------
// Per seed
// ---------------------------------------------------------------------------

let embedded = 0
for (const [i, row] of rows.entries()) {
  const doc = toDoc(row)
  const sent = inv.prepareText(doc)

  // The BARE document, which is what a provider-side probe should be given —
  // the prefix is Aperture's job and is exactly what is under test.
  const file = join(outDir, `seed-${i + 1}.txt`)
  writeFileSync(file, doc, 'utf8')

  console.log(`[${i + 1}/${rows.length}] ${row.title}${row.year ? ` (${row.year})` : ''}`)
  console.log('  document  :', `${Buffer.byteLength(doc, 'utf8')} bytes -> ${file}`)
  console.log('  prefixed  :', sent !== doc ? `YES (+${sent.length - doc.length} chars)` : 'no')
  console.log('  sent head :', JSON.stringify(sent.slice(0, 110)))

  if (embedded < limit) {
    const vector = await inv.embedOne(doc)
    // float32 little-endian, matching numpy asarray(v, dtype=float32).tobytes()
    const buf = Buffer.from(new Float32Array(vector).buffer)
    const norm = Math.sqrt(vector.reduce((acc, x) => acc + x * x, 0))
    console.log('  dimensions:', vector.length)
    console.log('  norm      :', norm.toFixed(6))
    console.log('  sha256    :', createHash('sha256').update(buf).digest('hex'))
    embedded++
  } else {
    console.log('  (not embedded — raise --limit to include it)')
  }
  console.log()
}

console.log(`Wrote ${rows.length} document(s) to ${outDir}; embedded ${embedded}.`)
console.log('To compare against a provider-side probe, embed the SAME file with')
console.log('the prefix shown above and check the sha256 matches.')

process.exit(0)
