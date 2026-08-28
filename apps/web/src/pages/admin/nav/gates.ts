import { useEffect, useState } from 'react'
import type { AdminGate } from './registry'

/**
 * Preconditions a destination can declare, resolved once per page load.
 *
 * The old settings page expressed the single gate it had — genre strips need
 * TMDB — as a `disabled` prop on one `<Tab>` plus an effect that bounced you to
 * a neighbouring sub-tab if you were already on it. Making it a property of the
 * registry entry means the nav, the route and the search index all read the
 * same answer instead of one of them being the only place that knows.
 *
 * The in-flight promise is shared at module scope so the nav column and the
 * route it links to make one request between them rather than one each.
 */

type GateState = { ready: boolean; passed: boolean }

/**
 * What to tell someone the section is waiting on. A `Record` keyed by the gate
 * union rather than a lookup at the call site, so adding a gate without saying
 * what it needs is a type error instead of a tooltip that names the wrong
 * integration. Keys stay literal so a search for unused strings can see them.
 */
export const GATE_TOOLTIP_KEYS: Record<AdminGate, string> = {
  tmdbConfigured: 'adminNav.gateTmdb',
}

const UNRESOLVED: GateState = { ready: false, passed: false }

let tmdbProbe: Promise<boolean> | null = null

async function probeTmdbConfigured(): Promise<boolean> {
  const res = await fetch('/api/settings/tmdb', { credentials: 'include' })
  if (!res.ok) return false
  const data = (await res.json()) as { isConfigured?: boolean }
  return Boolean(data.isConfigured)
}

function resolveGate(gate: AdminGate): Promise<boolean> {
  switch (gate) {
    case 'tmdbConfigured':
      // Only a *pass* is cached. A negative is the answer most likely to stop
      // being true while the console is open — configuring TMDB is one of the
      // things you come here to do — and caching it would leave the section
      // refusing until a reload. The old page re-probed on every tab change for
      // the same reason. A thrown probe is not cached either, so a transient
      // outage cannot latch the console into "not configured".
      tmdbProbe ??= probeTmdbConfigured()
        .then((configured) => {
          if (!configured) tmdbProbe = null
          return configured
        })
        .catch(() => {
          tmdbProbe = null
          return false
        })
      return tmdbProbe
  }
}

/**
 * Every gate the console knows about, for callers that render many entries and
 * cannot ask one at a time. Adding a second gate reaches the nav column without
 * touching it, which is the point of the registry declaring gates at all.
 */
export function useAdminGates(): Record<AdminGate, GateState> {
  return { tmdbConfigured: useAdminGate('tmdbConfigured') }
}

/**
 * `ready` distinguishes "not yet known" from "known to fail" — a gated section
 * must not accuse the operator of a missing integration while the answer is
 * still in flight.
 */
export function useAdminGate(gate: AdminGate | undefined): GateState {
  const [state, setState] = useState<GateState>(gate ? UNRESOLVED : { ready: true, passed: true })

  useEffect(() => {
    if (!gate) {
      setState({ ready: true, passed: true })
      return
    }

    let active = true
    setState(UNRESOLVED)
    void resolveGate(gate).then((passed) => {
      if (active) setState({ ready: true, passed })
    })

    return () => {
      active = false
    }
  }, [gate])

  return state
}
