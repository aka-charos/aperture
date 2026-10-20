// Which studio and network images does the media server hold, and how do they
// compare with the TMDb logos the logo job stored?
//
// Run inside the API container (it reuses Aperture's saved Emby connection, so
// the API key is never printed, and reads the database through core):
//
//   docker exec -i aperture node --input-type=module < scripts/probe-emby-studio-images.mjs
//
// Read-only: it lists studios and counts image types; it changes nothing.

const core = await import('/app/packages/core/dist/index.js')

const cfg = await core.getMediaServerConfig()
if (cfg.type !== 'emby' || !cfg.baseUrl || !cfg.apiKey) {
  console.log(`Media server is ${cfg.type ?? 'not configured'}; this probe reads Emby only.`)
  process.exit(0)
}
const base = cfg.baseUrl.replace(/\/+$/, '')
const IMAGE_TYPES = ['Primary', 'Thumb', 'Logo', 'Banner', 'Backdrop', 'Art', 'Disc']

async function embyStudios(itemType) {
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: itemType,
    Fields: 'ImageTags,BackdropImageTags',
    EnableImages: 'true',
    EnableImageTypes: IMAGE_TYPES.join(','),
  })
  const res = await fetch(`${base}/Studios?${params}`, {
    headers: { 'X-Emby-Token': cfg.apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`/Studios for ${itemType} answered ${res.status}`)
  const body = await res.json()
  return body.Items ?? []
}

function imageTypesOf(item) {
  const types = Object.keys(item.ImageTags ?? {})
  if ((item.BackdropImageTags ?? []).length > 0) types.push('Backdrop')
  return types
}

const sample = (names) => names.slice(0, 8).join(', ') || '—'

for (const [itemType, kind] of [['Movie', 'studio'], ['Series', 'network']]) {
  const items = await embyStudios(itemType)
  const byType = Object.fromEntries(IMAGE_TYPES.map((t) => [t, 0]))
  const embyImage = new Map()
  for (const item of items) {
    const types = imageTypesOf(item)
    for (const t of types) byType[t] = (byType[t] ?? 0) + 1
    embyImage.set(item.Name, types)
  }

  const rows = (
    await core.query(
      `SELECT name, logo_path IS NOT NULL AS has_tmdb FROM studios_networks WHERE type = $1`,
      [kind]
    )
  ).rows
  const buckets = { both: [], embyOnly: [], tmdbOnly: [], neither: [] }
  for (const row of rows) {
    const emby = (embyImage.get(row.name) ?? []).length > 0
    const key = emby && row.has_tmdb ? 'both' : emby ? 'embyOnly' : row.has_tmdb ? 'tmdbOnly' : 'neither'
    buckets[key].push(row.name)
  }

  console.log(`\n=== ${itemType} studios (Aperture type '${kind}') ===`)
  console.log(`Emby lists ${items.length}; ${[...embyImage.values()].filter((t) => t.length > 0).length} carry at least one image`)
  console.log(`Emby images by type: ${IMAGE_TYPES.map((t) => `${t} ${byType[t]}`).join(', ')}`)
  console.log(`Aperture rows ${rows.length}:`)
  console.log(`  Emby image AND TMDb logo: ${buckets.both.length}  e.g. ${sample(buckets.both)}`)
  console.log(`  Emby image only:          ${buckets.embyOnly.length}  e.g. ${sample(buckets.embyOnly)}`)
  console.log(`  TMDb logo only:           ${buckets.tmdbOnly.length}  e.g. ${sample(buckets.tmdbOnly)}`)
  console.log(`  neither:                  ${buckets.neither.length}`)
}

process.exit(0)
