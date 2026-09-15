/**
 * Where each feature's rows sit on a viewer's Emby home screen. Pure — no
 * database, no media server — so the arithmetic is pinned by a test.
 *
 * Emby has no "insert after" call. `POST …/HomeSections/Move` takes ids and a
 * `NewIndex`, and a row sent to an index ends up AT that index of the list as
 * Emby STORES it — which is not quite the list `GET …/HomeSections` returns.
 * Some rows are stored as one section and expanded per library on the way out:
 * "Latest Media" comes back as `latestmedia_<library id>`, one entry per
 * library, while Emby's own Home Screen editor shows it as a single line and no
 * row can sit between two of them. So every plan is made against the collapsed
 * list (`collapseExpandedRows`): a group is one row to anchor to, one row in a
 * position count, and one row to move around.
 *
 * Built-in rows share ids across accounts (`smalllibrarytiles`, `resume`, the
 * Latest Media group), which is what lets an anchor chosen once work for
 * everyone; rows someone added carry a random id and exist on one account. A
 * built-in row can also appear under a sibling id (My Media as
 * `librarybuttons`), so an anchor missing by id is looked for by section type —
 * except the generic container types, where "the same type" is any row a viewer
 * ever added.
 */

export const MAX_SECTION_POSITION = 50
const MAX_ANCHOR_ID_LENGTH = 200
const MAX_ANCHOR_TEXT_LENGTH = 200

/**
 * Bumped when what a stored placement MEANS changes, so every viewer is placed
 * once more under the new meaning. 2: expansion groups became one row.
 */
const PLACEMENT_KEY_VERSION = 2

/**
 * One placement per feature. The order is also the stacking order when several
 * features resolve to the same spot.
 */
export const PLACEMENT_FEATURES = [
  'top-picks-movies',
  'top-picks-series',
  'recs-movies',
  'recs-series',
  'playlists',
] as const

export type PlacementFeature = (typeof PLACEMENT_FEATURES)[number]

export function isPlacementFeature(value: unknown): value is PlacementFeature {
  return typeof value === 'string' && (PLACEMENT_FEATURES as readonly string[]).includes(value)
}

export const PLACEMENT_MODES = ['top', 'bottom', 'position', 'after', 'before'] as const
export type PlacementMode = (typeof PLACEMENT_MODES)[number]

export const FALLBACK_MODES = ['top', 'bottom', 'position'] as const
export type FallbackMode = (typeof FALLBACK_MODES)[number]

export interface PlacementAnchor {
  id: string
  /** The anchor's SectionType, for finding it on an account that shows it under a sibling id. */
  type: string | null
  /** Display only. Nothing matches on it: built-in names are translated per viewer. */
  name: string | null
}

export interface Placement {
  mode: PlacementMode
  /** Rows of the viewer's own above Aperture's; used by `position` only. */
  position: number
  /** Used by `after` and `before` only. */
  anchor: PlacementAnchor | null
}

/** An admin default: a placement, plus what an account lacking its anchor gets. */
export interface FeaturePlacement extends Placement {
  fallbackMode: FallbackMode
  fallbackPosition: number
}

export const DEFAULT_FEATURE_PLACEMENT: FeaturePlacement = {
  mode: 'top',
  position: 0,
  anchor: null,
  fallbackMode: 'bottom',
  fallbackPosition: 0,
}

/** Section types that describe a kind of container rather than one row. */
const GENERIC_SECTION_TYPES = new Set(['items', 'boxset'])

/** Whether a section type can stand in for a missing anchor of that type. */
export function isTypeMatchable(type: string | null): type is string {
  return !!type && !GENERIC_SECTION_TYPES.has(type)
}

/** Names for the groups Emby expands per library; Emby's read gives none for the group itself. */
const GROUP_NAMES: Readonly<Record<string, string>> = { latestmedia: 'Latest Media' }

/**
 * The group a section belongs to when Emby expanded it per library, recognised
 * by its id being the section type plus a suffix (`latestmedia_7`); null for a
 * row that is a row in its own right.
 */
export function expandedGroupOf(id: string, type: string | null): string | null {
  return type && id.startsWith(`${type}_`) ? type : null
}

export function groupName(group: string): string {
  return GROUP_NAMES[group] ?? group
}

/** An anchor on one library's expansion means the group it belongs to. */
export function normaliseAnchor(anchor: PlacementAnchor): PlacementAnchor {
  const group = expandedGroupOf(anchor.id, anchor.type)
  return group ? { id: group, type: group, name: groupName(group) } : anchor
}

export function isAnchorMode(mode: PlacementMode): mode is 'after' | 'before' {
  return mode === 'after' || mode === 'before'
}

function isPosition(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SECTION_POSITION
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, max) : null
}

/**
 * A placement from a request body. Whatever the chosen mode does not use is
 * normalised away — a Top placement keeps no anchor and position 0 — and an
 * anchor on one library's Latest row becomes the Latest Media group, so two
 * placements that behave the same are stored the same.
 */
export function sanitizePlacement(input: unknown, label: string): { placement: Placement | null; errors: string[] } {
  if (typeof input !== 'object' || input === null) {
    return { placement: null, errors: [`${label} must be an object`] }
  }
  const body = input as Record<string, unknown>
  if (typeof body.mode !== 'string' || !(PLACEMENT_MODES as readonly string[]).includes(body.mode)) {
    return { placement: null, errors: [`${label}.mode must be one of ${PLACEMENT_MODES.join(', ')}`] }
  }
  const mode = body.mode as PlacementMode
  const errors: string[] = []

  let position = 0
  if (mode === 'position') {
    if (isPosition(body.position)) position = body.position
    else errors.push(`${label}.position must be a whole number from 0 to ${MAX_SECTION_POSITION}`)
  }

  let anchor: PlacementAnchor | null = null
  if (isAnchorMode(mode)) {
    const raw = typeof body.anchor === 'object' && body.anchor !== null ? (body.anchor as Record<string, unknown>) : {}
    const id = optionalText(raw.id, MAX_ANCHOR_ID_LENGTH)
    if (id) {
      anchor = normaliseAnchor({
        id,
        type: optionalText(raw.type, MAX_ANCHOR_TEXT_LENGTH),
        name: optionalText(raw.name, MAX_ANCHOR_TEXT_LENGTH),
      })
    } else {
      errors.push(`${label}.anchor.id is required when placing ${mode} a row`)
    }
  }

  return errors.length > 0 ? { placement: null, errors } : { placement: { mode, position, anchor }, errors }
}

/** An admin default: a placement plus its fallback. */
export function sanitizeFeaturePlacement(
  input: unknown,
  label: string
): { placement: FeaturePlacement | null; errors: string[] } {
  const { placement, errors: placementErrors } = sanitizePlacement(input, label)
  const errors = [...placementErrors]
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>

  let fallbackMode: FallbackMode = DEFAULT_FEATURE_PLACEMENT.fallbackMode
  if (body.fallbackMode !== undefined) {
    if (typeof body.fallbackMode === 'string' && (FALLBACK_MODES as readonly string[]).includes(body.fallbackMode)) {
      fallbackMode = body.fallbackMode as FallbackMode
    } else {
      errors.push(`${label}.fallbackMode must be one of ${FALLBACK_MODES.join(', ')}`)
    }
  }

  let fallbackPosition = 0
  if (fallbackMode === 'position') {
    if (isPosition(body.fallbackPosition)) fallbackPosition = body.fallbackPosition
    else errors.push(`${label}.fallbackPosition must be a whole number from 0 to ${MAX_SECTION_POSITION}`)
  }

  if (!placement || errors.length > 0) return { placement: null, errors }
  return { placement: { ...placement, fallbackMode, fallbackPosition }, errors: [] }
}

function normalise(placement: Placement): Placement {
  return {
    mode: placement.mode,
    position: placement.mode === 'position' ? placement.position : 0,
    anchor: isAnchorMode(placement.mode) && placement.anchor ? normaliseAnchor(placement.anchor) : null,
  }
}

/**
 * The placements tried, in order, for one viewer's rows of one feature. A
 * viewer's override leads. Only an anchor can miss, so the admin default is
 * reached after an override only when the override is an anchor, and the admin
 * fallback only after the admin anchor.
 */
export function placementChain(adminDefault: FeaturePlacement, override: Placement | null): Placement[] {
  const adminChain: Placement[] = [normalise(adminDefault)]
  if (isAnchorMode(adminDefault.mode)) {
    adminChain.push({ mode: adminDefault.fallbackMode, position: adminDefault.fallbackPosition, anchor: null })
  }
  if (!override) return adminChain
  return isAnchorMode(override.mode) ? [normalise(override), ...adminChain] : [normalise(override)]
}

/**
 * A stable key for a chain, stored per viewer per feature as what was applied.
 * Names are left out: renaming a row somewhere else must not move anybody's.
 */
export function placementKey(chain: readonly Placement[]): string {
  return JSON.stringify([
    PLACEMENT_KEY_VERSION,
    chain.map((placement) => {
      const p = normalise(placement)
      return [p.mode, p.position, p.anchor?.id ?? null, p.anchor?.type ?? null]
    }),
  ])
}

/** One row of a viewer's home screen, in the order Emby returns them. */
export interface HomeScreenRow {
  id: string
  sectionType: string | null
  /** The feature an Aperture row belongs to; null for every row that is not Aperture's. */
  feature: PlacementFeature | null
  /** Orders rows within a feature (playlists by name). */
  name: string
  /** True for a group of per-library expansions collapsed into one row. */
  group?: boolean
}

/**
 * A viewer's rows as Emby stores them: every expansion of a group collapsed into
 * one row where the group first appears. Plans are made, counted and moved
 * against this list.
 */
export function collapseExpandedRows(rows: readonly HomeScreenRow[]): HomeScreenRow[] {
  const collapsed: HomeScreenRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const group = row.feature === null ? expandedGroupOf(row.id, row.sectionType) : null
    if (!group) {
      collapsed.push(row)
    } else if (!seen.has(group)) {
      seen.add(group)
      collapsed.push({ id: group, sectionType: group, feature: null, name: groupName(group), group: true })
    }
  }
  return collapsed
}

/**
 * Whether every group's expansions sit together. A row between two of them is
 * something Emby's own editor cannot show — so after a move, it means the move
 * landed somewhere the plan did not intend.
 */
export function groupsAreContiguous(rows: readonly HomeScreenRow[]): boolean {
  const finished = new Set<string>()
  let current: string | null = null
  for (const row of rows) {
    const group = row.feature === null ? expandedGroupOf(row.id, row.sectionType) : null
    if (group === current) continue
    if (current) finished.add(current)
    if (group && finished.has(group)) return false
    current = group
  }
  return true
}

function featureRank(feature: PlacementFeature): number {
  return PLACEMENT_FEATURES.indexOf(feature)
}

function findAnchor(list: readonly HomeScreenRow[], anchor: PlacementAnchor | null): number {
  if (!anchor) return -1
  const wanted = normaliseAnchor(anchor)
  const byId = list.findIndex((row) => row.feature === null && row.id === wanted.id)
  if (byId >= 0 || !isTypeMatchable(wanted.type)) return byId
  return list.findIndex((row) => row.feature === null && row.sectionType === wanted.type)
}

/** The index just after the viewer's `count`-th own row. Aperture's rows are not counted. */
function indexAfterOwnRows(list: readonly HomeScreenRow[], count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i].feature !== null) continue
    seen++
    if (seen === count) return i + 1
  }
  return list.length
}

/**
 * The index a chain resolves to in `list` — a collapsed list, so a group is one
 * row. Exhausting the chain means the bottom.
 */
export function resolvePlacementIndex(list: readonly HomeScreenRow[], chain: readonly Placement[]): number {
  for (const placement of chain) {
    switch (placement.mode) {
      case 'top':
        return 0
      case 'bottom':
        return list.length
      case 'position':
        return indexAfterOwnRows(list, placement.position)
      case 'after': {
        const index = findAnchor(list, placement.anchor)
        if (index >= 0) return index + 1
        break
      }
      case 'before': {
        const index = findAnchor(list, placement.anchor)
        if (index >= 0) return index
        break
      }
    }
  }
  return list.length
}

export interface PlacementMove {
  id: string
  index: number
}

export interface PlacementPlan {
  /** The viewer's row ids in their final order, groups collapsed. */
  order: string[]
  /** `Move` calls, one row each, in the order they must be sent; indexes count the collapsed list. */
  moves: PlacementMove[]
}

/**
 * Place the rows of the features in `chains` on one viewer's home screen. Rows
 * of any other feature stay exactly where they are — that is what keeps a
 * viewer's own drag — but are still recognised as Aperture's, so they are not
 * counted by a position and features stack in PLACEMENT_FEATURES order.
 */
export function planPlacement(
  screen: readonly HomeScreenRow[],
  chains: ReadonlyMap<PlacementFeature, readonly Placement[]>
): PlacementPlan {
  const rows = collapseExpandedRows(screen)
  const moving = rows.filter((row) => row.feature !== null && chains.has(row.feature))
  const movingIds = new Set(moving.map((row) => row.id))
  const list = rows.filter((row) => !movingIds.has(row.id))

  for (const feature of PLACEMENT_FEATURES) {
    const chain = chains.get(feature)
    const group = moving.filter((row) => row.feature === feature)
    if (!chain || group.length === 0) continue
    if (feature === 'playlists') {
      group.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    }

    let index = resolvePlacementIndex(list, chain)
    // Rows of an earlier feature already at this spot keep the lead.
    while (index < list.length) {
      const here = list[index].feature
      if (here === null || featureRank(here) >= featureRank(feature)) break
      index++
    }
    list.splice(index, 0, ...group)
  }

  const order = list.map((row) => row.id)
  return { order, moves: planPlacementMoves(rows.map((row) => row.id), order, movingIds) }
}

/**
 * The `Move` calls that turn `current` into `target`, moving only ids in
 * `movable`. Each call is simulated as Emby performs it — take the row out, put
 * it back at the index — so the next call is planned against the list that call
 * leaves behind.
 */
export function planPlacementMoves(
  current: readonly string[],
  target: readonly string[],
  movable: ReadonlySet<string>
): PlacementMove[] {
  if (current.length !== target.length) {
    throw new Error('planPlacementMoves: the current and target lists differ in length')
  }
  const list = [...current]
  const moves: PlacementMove[] = []
  const apply = (id: string, index: number) => {
    list.splice(list.indexOf(id), 1)
    list.splice(Math.min(index, list.length), 0, id)
    moves.push({ id, index })
  }

  let budget = current.length * 2 + 1
  for (let i = 0; i < target.length; i++) {
    while (list[i] !== target[i]) {
      if (budget-- <= 0) throw new Error('planPlacementMoves did not converge')
      if (movable.has(target[i])) apply(target[i], i)
      else if (movable.has(list[i])) apply(list[i], list.length - 1)
      else throw new Error('planPlacementMoves: rows that may not move are out of order')
    }
  }
  return moves
}
