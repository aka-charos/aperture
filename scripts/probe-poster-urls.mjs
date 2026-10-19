// Why does a poster that Emby shows come up as "NO POSTER FOUND" in Aperture?
//
// The title page draws the placeholder in two cases: the row has no
// poster_url, or the browser's request for it failed (the <img> onError). This
// probe separates them.
//
// Part 1, the whole library, cheap: every movie and series row's stored
// poster_url against what Emby reports for that item NOW — item gone, no
// poster stored while Emby has one, a URL naming another item, a stale tag.
// One paged /Items listing per type; no image is downloaded.
//
// Part 2, the titles you name: each one's stored poster fetched exactly as the
// image proxy fetches it (with the maxWidth it adds since 695447f5) and
// without the size, so a resize failure on Emby's side shows up as one
// answering and the other not.
//
// Run inside the API container (it reuses Aperture's saved Emby connection, so
// the API key is never printed):
//
//   docker exec -i aperture node --input-type=module - "Mallrats" < scripts/probe-poster-urls.mjs
//
// Any number of titles may follow the "-". Read-only: it changes nothing.

const core = await import('/app/packages/core/dist/index.js')
const db = await import('/app/packages/core/dist/lib/db.js')

const titles = process.argv.slice(2).filter((a) => a !== '-')

const cfg = await core.getMediaServerConfig()
if (cfg.type !== 'emby' || !cfg.baseUrl || !cfg.apiKey) {
  console.log(`Media server is ${cfg.type ?? 'not configured'}; this probe reads Emby only.`)
  process.exit(0)
}
const base = cfg.baseUrl.replace(/\/+$/, '')
const headers = { 'X-Emby-Token': cfg.apiKey, Accept: 'application/json' }

/** Every item of one type, with its current Primary image tag. */
async function embyItems(itemType) {
  const items = new Map()
  const pageSize = 1000
  for (let start = 0; ; start += pageSize) {
    const params = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: itemType,
      Fields: 'ProviderIds',
      EnableImageTypes: 'Primary',
      // Paging needs a fixed order, or a page can repeat or skip items.
      SortBy: 'SortName,Id',
      StartIndex: String(start),
      Limit: String(pageSize),
    })
    const res = await fetch(`${base}/Items?${params}`, { headers })
    if (!res.ok) throw new Error(`/Items ${itemType} answered ${res.status}`)
    const body = await res.json()
    for (const item of body.Items ?? []) {
      items.set(String(item.Id), { name: item.Name, primaryTag: item.ImageTags?.Primary ?? null })
    }
    if ((body.Items ?? []).length < pageSize) break
  }
  return items
}

/** Item id and tag out of a stored poster URL. */
function parsePosterUrl(url) {
  if (!url) return null
  const m = /\/Items\/([^/]+)\/Images\/Primary/i.exec(url)
  if (!m) return { foreign: true }
  let tag = null
  try {
    tag = new URL(url).searchParams.get('tag')
  } catch {
    const t = /[?&]tag=([^&]+)/.exec(url)
    tag = t ? t[1] : null
  }
  return { itemId: m[1], tag }
}

/**
 * Whether two Emby image tags name the same image. A tag is
 * `<hash>_<ticks>[_<suffix>]`, and Emby appends the suffix depending on what a
 * listing asked for, so only the first two parts are compared.
 */
function sameImage(a, b) {
  const head = (tag) => String(tag).split('_').slice(0, 2).join('_')
  return head(a) === head(b)
}

async function auditTable(table, itemType) {
  const emby = await embyItems(itemType)
  const rows = await db.query(`SELECT id, title, year, provider_item_id, poster_url FROM ${table}`)
  const buckets = {
    ok: [],
    goneFromEmby: [],
    noPosterStoredButEmbyHasOne: [],
    noPosterAnywhere: [],
    urlNamesAnotherItem: [],
    staleTag: [],
    storedButEmbyHasNone: [],
    notAnEmbyUrl: [],
  }
  for (const row of rows.rows) {
    const item = emby.get(String(row.provider_item_id))
    const parsed = parsePosterUrl(row.poster_url)
    const label = `${row.title} (${row.year ?? '?'}) [${row.provider_item_id}]`
    if (!item) buckets.goneFromEmby.push(label)
    else if (!parsed) (item.primaryTag ? buckets.noPosterStoredButEmbyHasOne : buckets.noPosterAnywhere).push(label)
    else if (parsed.foreign) buckets.notAnEmbyUrl.push(`${label} ${row.poster_url}`)
    else if (parsed.itemId !== String(row.provider_item_id)) buckets.urlNamesAnotherItem.push(`${label} -> ${parsed.itemId}`)
    else if (!item.primaryTag) buckets.storedButEmbyHasNone.push(label)
    else if (parsed.tag && sameImage(parsed.tag, item.primaryTag) === false)
      buckets.staleTag.push(`${label}
        stored ${parsed.tag}
        Emby   ${item.primaryTag}`)
    else buckets.ok.push(label)
  }
  console.log(`\n== ${table}: ${rows.rows.length} rows, ${emby.size} ${itemType} items in Emby`)
  for (const [name, list] of Object.entries(buckets)) {
    console.log(`  ${name.padEnd(30)} ${list.length}`)
    const shown = name === 'staleTag' ? 3 : 15
    if (name !== 'ok') for (const line of list.slice(0, shown)) console.log(`      ${line}`)
    if (name !== 'ok' && list.length > shown) console.log(`      … ${list.length - shown} more`)
  }
}

async function fetchImage(url) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: {
        'X-Emby-Authorization': `MediaBrowser Client="Aperture", Device="Aperture Server", DeviceId="aperture-server", Version="1.0.0", Token="${cfg.apiKey}"`,
      },
    })
    const body = Buffer.from(await res.arrayBuffer())
    const text = res.ok ? '' : ` "${body.toString('utf8').slice(0, 300).replace(/\s+/g, ' ')}"`
    return `${res.status} ${res.headers.get('content-type') ?? '-'} ${body.byteLength} bytes ${Date.now() - started} ms${text}`
  } catch (err) {
    return `no answer: ${err?.message ?? err} (${Date.now() - started} ms)`
  }
}

/** Every Emby movie or series matching a title, with where it lives. */
async function embyCopies(title) {
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Series',
    SearchTerm: title,
    Fields: 'Path,ProviderIds,ParentId',
    EnableImageTypes: 'Primary',
    Limit: '20',
  })
  const res = await fetch(`${base}/Items?${params}`, { headers })
  if (!res.ok) {
    console.log(`  Emby search answered ${res.status}`)
    return
  }
  const items = (await res.json()).Items ?? []
  console.log(`  Emby has ${items.length} item(s) matching "${title}":`)
  for (const item of items) {
    console.log(
      `    ${item.Type} ${item.Id} "${item.Name}" (${item.ProductionYear ?? '?'}) tmdb ${item.ProviderIds?.Tmdb ?? '-'} imdb ${item.ProviderIds?.Imdb ?? '-'}`
    )
    console.log(`      path ${item.Path ?? '(none)'}`)
    console.log(`      poster ${await fetchImage(`${base}/Items/${item.Id}/Images/Primary?maxWidth=720`)}`)
  }
}

async function probeTitle(title) {
  console.log(`
== Emby search: "${title}"`)
  await embyCopies(title)
  const rows = await db.query(
    `SELECT 'movie' AS kind, id, title, year, provider_item_id, poster_url FROM movies WHERE title ILIKE $1
     UNION ALL
     SELECT 'series', id, title, year, provider_item_id, poster_url FROM series WHERE title ILIKE $1`,
    [title]
  )
  if (rows.rows.length === 0) {
    console.log(`\n== "${title}": no library row`)
    return
  }
  for (const row of rows.rows) {
    console.log(`\n== ${row.kind} "${row.title}" (${row.year}) id ${row.id}, Emby item ${row.provider_item_id}`)
    console.log(`  stored poster_url: ${row.poster_url ?? '(none)'}`)
    const res = await fetch(
      `${base}/Items?Ids=${row.provider_item_id}&Fields=Path,ParentId&EnableImageTypes=Primary`,
      { headers }
    )
    const item = res.ok ? (await res.json()).Items?.[0] : null
    console.log(`  Emby now: ${item ? `"${item.Name}", Primary tag ${item.ImageTags?.Primary ?? '(none)'}, path ${item.Path ?? '(none)'}` : `item not returned (${res.status})`}`)
    if (!row.poster_url) continue
    const parsed = parsePosterUrl(row.poster_url)
    if (!parsed || parsed.foreign) continue
    const stored = `${base}/Items/${parsed.itemId}/Images/Primary${parsed.tag ? `?tag=${parsed.tag}` : ''}`
    const sized = `${stored}${parsed.tag ? '&' : '?'}maxWidth=720`
    console.log(`  as the proxy asks (maxWidth=720): ${await fetchImage(sized)}`)
    console.log(`  without a size:                   ${await fetchImage(stored)}`)
    console.log(`  no tag, maxWidth=720:             ${await fetchImage(`${base}/Items/${parsed.itemId}/Images/Primary?maxWidth=720`)}`)
  }
}

try {
  await auditTable('movies', 'Movie')
  await auditTable('series', 'Series')
  for (const title of titles) await probeTitle(title)
} finally {
  await db.closePool()
}
