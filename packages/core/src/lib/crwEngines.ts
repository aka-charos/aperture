/**
 * Which search engine to try first, given what the recent ones did.
 *
 * THE PROBLEM THIS SOLVES. `CrwConfig.searchEngines` is an ordered cascade —
 * try Google, fall back to DuckDuckGo, then Bing — and on its own that is
 * enough to keep a run working when the first engine is blocked. What it is not
 * is cheap: a blocked engine still gets one request per title, forever. Measured
 * live, a Google `/sorry/index` wall answered in ~1.4s and did so for every
 * title in the pass. Against a title that takes 45s–3min that is noise, but
 * across a 13,000-title library it is hours of requests to a service that has
 * already said no, and hammering a wall is not how a block gets lifted.
 *
 * WHY CONSECUTIVE, AND WHY 5. A single empty answer is genuinely ambiguous:
 * CRW returns `200 {results: []}` both for "this engine is walled" and for "the
 * web has nothing on this obscure title", and the warning text does not
 * distinguish them either. Counting *consecutive* empties across *different
 * titles* separates them — five unrelated titles in a row producing nothing
 * from one engine while the run continues is a property of the engine, not of
 * the films. Same reasoning as `CONSECUTIVE_FAILURE_LIMIT` in the analysis job,
 * and the same number for the same reason: one hard title is isolated, five in
 * a row is a system.
 *
 * PARKED ENGINES MOVE TO THE BACK, THEY ARE NEVER DROPPED. Filtering could
 * empty the list, and an empty list means CRW applies its own default — Google
 * alone — which is exactly the state this is trying to escape. Reordering
 * cannot: something is always tried, and a parked engine is still there as a
 * last resort if the others fail too.
 *
 * IN MEMORY, AND IT EXPIRES. Losing this on restart costs at most five wasted
 * requests to rediscover a block, whereas persisting it risks starting up with
 * a stale opinion about an engine that has been fine for a week. The expiry is
 * what makes recovery automatic: a block lifts, the cooldown lapses, the engine
 * returns to the front of the list on its own and nobody has to remember to
 * change a setting back.
 */
import type { CrwSearchEngine } from './crw.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('crw-engines')

/** Consecutive empty answers before an engine is moved to the back. */
export const ENGINE_FAILURE_LIMIT = 5

/** How long a parked engine stays parked. */
export const ENGINE_COOLDOWN_MS = 30 * 60 * 1000

export interface EngineHealth {
  /** Consecutive empty answers. Reset by any answer at all. */
  failures: number
  /** Epoch ms this engine may be tried first again, or 0 when it is not parked. */
  parkedUntil: number
}

const health = new Map<CrwSearchEngine, EngineHealth>()

const entry = (engine: CrwSearchEngine): EngineHealth =>
  health.get(engine) ?? { failures: 0, parkedUntil: 0 }

/**
 * Reorder a configured cascade so parked engines are tried last.
 *
 * Pure apart from reading the clock, and stable: engines that are not parked
 * keep the operator's order exactly, because that order is a preference about
 * result quality and this function's only job is to skip a known wall.
 */
export function orderByHealth(
  engines: CrwSearchEngine[],
  now = Date.now()
): CrwSearchEngine[] {
  const parked = (e: CrwSearchEngine) => entry(e).parkedUntil > now
  return [...engines.filter((e) => !parked(e)), ...engines.filter(parked)]
}

/**
 * Record what an engine did.
 *
 * `answered` means it returned at least one result — not that the result was
 * any good. Judging quality is `sourceFloor.ts`'s job and it needs text to do
 * it; all this decides is whether the engine is reachable and willing.
 */
export function recordEngineOutcome(
  engine: CrwSearchEngine,
  answered: boolean,
  now = Date.now()
): void {
  if (answered) {
    // Clears the park as well as the count: an engine that just answered is
    // working, whatever it did five titles ago.
    if (health.has(engine)) health.delete(engine)
    return
  }

  const current = entry(engine)
  const failures = current.failures + 1
  const parkedUntil = failures >= ENGINE_FAILURE_LIMIT ? now + ENGINE_COOLDOWN_MS : current.parkedUntil
  health.set(engine, { failures, parkedUntil })

  // Logged once, at the moment of parking rather than on every failure after
  // it, so the line means "something changed" instead of joining the noise it
  // exists to explain.
  if (parkedUntil !== current.parkedUntil) {
    logger.warn(
      { engine, failures, cooldownMinutes: Math.round(ENGINE_COOLDOWN_MS / 60000) },
      'Search engine returned nothing repeatedly — trying it last for now'
    )
  }
}

/** Current state, for logs and tests. Never a live reference. */
export function engineHealthSnapshot(): Record<string, EngineHealth> {
  return Object.fromEntries([...health.entries()].map(([k, v]) => [k, { ...v }]))
}

/** Test seam. Nothing in the app should need this. */
export function resetEngineHealth(): void {
  health.clear()
}
