/**
 * Minimum spacing between model calls, for credentials on a free tier.
 *
 * WHY THIS EXISTS. A free-tier key is rate-limited per MINUTE as well as per
 * day — OpenRouter's free models share one per-account requests-per-minute
 * budget, and Google's free Gemini tiers publish RPM alongside RPD. A batch job
 * that walks a library calls the model as fast as each title finishes, which on
 * a fast provider is several times a minute; the run then spends most of its
 * budget collecting 429s, and the ones it collects are indistinguishable in the
 * log from a provider being down.
 *
 * The SDK's own backoff does not solve this. It reacts to a 429 that has
 * already been spent, with a delay measured in hundreds of milliseconds against
 * a window measured in minutes — so it converts one refusal into several. What
 * actually works on a per-minute cap is not making the request yet.
 *
 * WHY A RESERVATION AND NOT A TIMESTAMP. The obvious implementation records
 * when the last call started and makes the next one wait out the difference.
 * That is wrong under concurrency, which this genuinely has: the on-demand
 * button and the batch job share these credentials, and two callers arriving
 * together both read the same last-call time, both wait the same amount, and
 * both fire at the same instant — pacing that does nothing precisely when two
 * things are running. `reserveSlot` instead hands out a start time and moves
 * the marker forward in the same synchronous step, so the second caller is
 * given a slot after the first rather than beside it.
 *
 * THE CLOCK IS RECORDED AT THE START OF A CALL, not at its end. Providers count
 * requests as they arrive, so what matters is how far apart requests are
 * ISSUED. Spacing from the end would also punish a slow model twice: a local
 * model taking three minutes per title has already spaced itself far past any
 * per-minute cap, and adding a further minute on top would halve a run for no
 * reason.
 *
 * KEYED BY PROVIDER, not by role or model. The limit belongs to the account, so
 * falling back from one OpenRouter free model to another must keep waiting
 * while falling back to a local server must not. A role's setting is what turns
 * pacing ON; the provider is what it applies to.
 */
import { createChildLogger } from './logger.js'

const logger = createChildLogger('call-pacing')

/**
 * Providers that answer from the operator's own hardware, where there is no
 * account and so no requests-per-minute budget to respect.
 *
 * A call to LM Studio or Ollama costs its own latency and nothing else: nobody
 * is counting the requests, and a three-minute generation has already spaced
 * itself past any cap that exists elsewhere. Spacing there only makes a library
 * pass slower for no reason, so the option is not offered and a stored value is
 * not honoured.
 *
 * `openai-compatible` is deliberately NOT on this list. It is "local" for model
 * discovery, but the same provider is how a hosted gateway with a real
 * per-minute cap is reached, and nothing about the address can say which one an
 * operator pointed it at. Wrongly hiding the setting there strands someone with
 * no way to turn it on; wrongly offering it costs one unticked checkbox. The
 * mirror of this list in the web bundle is `PROVIDERS_WITHOUT_RATE_LIMIT`.
 */
export const PROVIDERS_WITHOUT_RATE_LIMIT: readonly string[] = ['lmstudio', 'ollama']

/** Whether spacing a provider's calls can mean anything. Unknown reads as yes. */
export function providerHasRateLimit(provider: string | null | undefined): boolean {
  return !provider || !PROVIDERS_WITHOUT_RATE_LIMIT.includes(provider)
}

/**
 * Ceiling on the pacing knob. An hour between calls is already far beyond any
 * published free tier; past that the setting stops being pacing and becomes a
 * way to make a job appear hung.
 */
export const MAX_CALL_SPACING_SECONDS = 3600

/**
 * Spacing in milliseconds for a provider, or 0 when pacing is off or cannot
 * apply. The one place the stored number and the provider are read together,
 * so a stored value that outlived a switch to a local model cannot delay it.
 */
export function resolveSpacingMs(
  provider: string | null | undefined,
  seconds: unknown
): number {
  if (!providerHasRateLimit(provider)) return 0
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(seconds, MAX_CALL_SPACING_SECONDS) * 1000
}

/**
 * Spacing for one attempt of a role whose pacing was set against `roleProvider`.
 *
 * The stored number describes the role's own provider's account, so it applies
 * to an attempt on THAT provider and to no other: a spare model on the same
 * OpenRouter account shares its per-minute budget, while a spare on a local
 * server or a different account shares nothing and must not wait. The gate is
 * keyed by provider for the same reason, so this is the other half of that rule.
 */
export function spacingMsForAttempt(
  roleProvider: string | null | undefined,
  roleSeconds: unknown,
  attemptProvider: string
): number {
  return attemptProvider === roleProvider ? resolveSpacingMs(attemptProvider, roleSeconds) : 0
}

/**
 * The pacing number worth storing for a provider: undefined when it would do
 * nothing. Off is absent rather than 0, like `freeTier` — writing the default
 * into every role's config only makes the blob noisier — and a local provider
 * never keeps one, so switching a role back to a hosted model starts from the
 * documented default (off) instead of resurrecting a delay nobody can see.
 */
export function storableCallSpacingSeconds(
  provider: string | null | undefined,
  seconds: number | null | undefined
): number | undefined {
  if (!providerHasRateLimit(provider)) return undefined
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(Math.round(seconds), MAX_CALL_SPACING_SECONDS)
}

/** How often the wait wakes up to check for cancellation. */
const POLL_MS = 500

/**
 * Earliest permitted start per provider. In memory, like the web-search key
 * cooldowns and for the same reason: losing it on restart costs at most one
 * un-spaced call, while persisting it would make a container that has been down
 * for an hour sit out a delay it already served.
 */
const markers = new Map<string, SlotMarker>()

/**
 * What a key remembers between calls.
 *
 * `issuedAt` is not bookkeeping — it is the only reliable way to notice that
 * the clock moved BACKWARDS. An NTP correction or a resumed host makes `now`
 * earlier than the moment a reservation was made, and a reservation honoured
 * literally would then park the job for the length of the jump. Comparing the
 * two timestamps detects that exactly, where a cap on the wait would only
 * approximate it — and would collapse a legitimate queue of callers in the
 * process, which is the case pacing exists to handle.
 */
export interface SlotMarker {
  /** Earliest permitted start of the next call. */
  nextAllowedAt: number
  /** The clock reading that produced it. */
  issuedAt: number
}

/** The decision, with no clock and no state — so it can be tested outright. */
export interface SlotReservation {
  /** When this call may start. */
  startAt: number
  /** The marker to store, reserving the slot against a concurrent caller. */
  marker: SlotMarker
}

/**
 * Claim the next slot for a key.
 *
 * Pure: the caller supplies the previous marker and the clock, and stores what
 * comes back. Concurrency safety comes from the CALLER doing both in one
 * synchronous step — see `waitForCallSlot`.
 */
export function reserveSlot(
  previous: SlotMarker | undefined,
  now: number,
  spacingMs: number
): SlotReservation {
  if (spacingMs <= 0) return { startAt: now, marker: { nextAllowedAt: now, issuedAt: now } }

  // Clock went backwards since the reservation was made. Everything stored is
  // measured against a reading that no longer exists, so start over rather than
  // serve a wait of unknown length.
  const usable = previous && now >= previous.issuedAt ? previous : undefined

  const startAt = Math.max(now, usable?.nextAllowedAt ?? now)
  return { startAt, marker: { nextAllowedAt: startAt + spacingMs, issuedAt: now } }
}

export interface PacingOptions {
  /**
   * Polled while waiting. A cool-off of a minute is long enough that a Stop
   * pressed during one has to take effect inside it — otherwise the button
   * looks dead for the whole delay, which is what makes an operator reach for
   * `docker stop` instead.
   */
  shouldCancel?: () => Promise<boolean> | boolean
  /** Told how long the wait will be, so a job console can say why it is idle. */
  onWait?: (seconds: number) => void
}

export interface PacingResult {
  cancelled: boolean
  waitedMs: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Wait until this provider's next call is due.
 *
 * Returns immediately, and records nothing at all, when spacing is off — which
 * is the default, so an operator who has not asked for pacing pays no map entry
 * and no branch beyond this one.
 */
export async function waitForCallSlot(
  key: string,
  spacingMs: number,
  options: PacingOptions = {}
): Promise<PacingResult> {
  if (spacingMs <= 0) return { cancelled: false, waitedMs: 0 }

  // Read and write in one synchronous step, with no await between them: that
  // is what makes two callers arriving together receive two different slots
  // rather than the same one.
  const now = Date.now()
  const reservation = reserveSlot(markers.get(key), now, spacingMs)
  markers.set(key, reservation.marker)

  const waitMs = reservation.startAt - now
  if (waitMs <= 0) return { cancelled: false, waitedMs: 0 }

  // Announced before the wait, never after. This is a deliberate pause of up to
  // a minute in the middle of a job whose other steps are also minutes long —
  // unannounced it is indistinguishable from the run having wedged, which is
  // the exact failure the "Retrieving sources" and "Writing analysis" lines
  // were added to fix.
  const seconds = Math.ceil(waitMs / 1000)
  logger.info({ key, seconds, spacingMs }, 'Pacing: waiting before the next model call')
  options.onWait?.(seconds)

  const until = reservation.startAt
  while (Date.now() < until) {
    if (options.shouldCancel && (await options.shouldCancel()) === true) {
      return { cancelled: true, waitedMs: Date.now() - now }
    }
    await sleep(Math.min(POLL_MS, until - Date.now()))
  }

  return { cancelled: false, waitedMs: Date.now() - now }
}

/** Drop every reservation. Tests only — nothing in the app clears these. */
export function resetCallPacing(): void {
  markers.clear()
}
