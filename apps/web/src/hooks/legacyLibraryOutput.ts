import { useEffect, useSyncExternalStore } from 'react'

/**
 * Whether legacy library output — per-viewer AI Picks and shared Top Picks
 * libraries written as STRM files or symlinks — is switched on, shared by every
 * surface that greys itself out when it is not.
 *
 * Module-level rather than a provider for the reason `activeJobs.ts` gives: the
 * readers are scattered (the console's nav column, four settings sections, the
 * Jobs page, the Users page) and none of them should need a provider above it.
 * It is one fetch per page load, and saving the switch updates every reader at
 * once — so the nav dims and the sections grey the moment it is flipped, not
 * after a reload.
 *
 * Unknown reads as ON. A non-admin and a failed request both get the behaviour
 * from before the switch existed; nothing is ever greyed out on a guess.
 */

export interface GeneratedLibraryCounts {
  total: number
  personal: number
  topPicks: number
  channels: number
}

export interface LegacyLibraryOutputState {
  /** False until the first answer arrives. */
  ready: boolean
  /** The switch. True while unknown. */
  enabled: boolean
  /** Known to be switched off — the one question every greyed control asks. */
  off: boolean
  /** Libraries recorded as generated, i.e. what the removal job would find. Null when unknown. */
  generatedLibraries: GeneratedLibraryCounts | null
}

const UNKNOWN: LegacyLibraryOutputState = {
  ready: false,
  enabled: true,
  off: false,
  generatedLibraries: null,
}

let state: LegacyLibraryOutputState = UNKNOWN
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

/**
 * A read takes a number when it starts, a save when it finishes, and only an
 * answer numbered above the last one published is published. Without it a GET
 * sent before a save could land after it and put the old value back — the
 * switch snapping on again with the server holding off, until a reload.
 */
let issued = 0
let published = 0

function publish(next: LegacyLibraryOutputState, sequence: number): void {
  if (sequence < published) return
  published = sequence
  state = next
  for (const listener of listeners) listener()
}

function fromResponse(data: { enabled?: boolean; generatedLibraries?: GeneratedLibraryCounts }): LegacyLibraryOutputState {
  // Absent is not false: an API from before the switch existed wrote libraries.
  const enabled = data.enabled !== false
  return { ready: true, enabled, off: !enabled, generatedLibraries: data.generatedLibraries ?? null }
}

/**
 * Fetch the switch. Shared while in flight; `force` asks again, for the card
 * that has just started a removal and wants the count to move.
 */
export function loadLegacyLibraryOutput(force = false): Promise<void> {
  if (inflight && !force) return inflight
  const sequence = ++issued
  const request = fetch('/api/settings/legacy-library-output', { credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) {
        // Not cached either: a 401 from before signing in must not outlive
        // the sign-in, so the next reader to mount asks again.
        if (inflight === request) inflight = null
        publish({ ...UNKNOWN, ready: true }, sequence)
        return
      }
      publish(fromResponse(await response.json()), sequence)
    })
    .catch(() => {
      // Not cached: a dropped request must not latch the console into an
      // answer, so the next reader to mount asks again.
      if (inflight === request) inflight = null
      publish({ ...state, ready: true }, sequence)
    })
  inflight = request
  return request
}

/** Save the switch and hand every reader the new answer. Throws the server's sentence on failure. */
export async function saveLegacyLibraryOutput(enabled: boolean): Promise<void> {
  const response = await fetch('/api/settings/legacy-library-output', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || '')
  }
  const saved = fromResponse(await response.json())
  // Numbered on COMPLETION, not on sending: any read started before the save
  // finished may have seen the old value, so none of them may follow it.
  publish(saved, ++issued)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current answer, for a caller outside React (a gate resolving a promise). */
export function currentLegacyLibraryOutput(): LegacyLibraryOutputState {
  return state
}

/**
 * `fresh` asks the server again even when this page load already has an
 * answer — for the card whose count moves when a removal finishes elsewhere.
 * One request either way: the fresh read REPLACES the shared one rather than
 * following it.
 */
export function useLegacyLibraryOutput(options: { fresh?: boolean } = {}): LegacyLibraryOutputState {
  const current = useSyncExternalStore(subscribe, currentLegacyLibraryOutput)
  const fresh = options.fresh === true
  useEffect(() => {
    void loadLegacyLibraryOutput(fresh)
  }, [fresh])
  return current
}
