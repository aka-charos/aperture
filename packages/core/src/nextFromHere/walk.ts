/**
 * "Take me somewhere": a walk that follows Next from here's own choices. From
 * the start it steps to the best suggestion, then to the best suggestion from
 * there, and so on, so every step carries the reasons the list would give —
 * where Trails' walk drew among the strongest links at random and read as
 * random. Two rules keep it a walk rather than one person's filmography: it
 * never returns to a title already on the trail, and it does not follow the
 * same person or franchise twice while another suggestion is on offer.
 *
 * Pure apart from the callback that scores a title's suggestions (it reads
 * the embedding); pinned by nextFromHere.test.ts.
 */

import type { Candidate } from './taste.js'

export interface WalkStepChoice {
  from: number
  to: Candidate
}

/**
 * The suggestion to step to: the best one not on the trail whose leading
 * shared credit has not been followed yet, else the best one not on the trail.
 */
export function chooseWalkStep(
  candidates: readonly Candidate[],
  visited: ReadonlySet<number>,
  followed: ReadonlySet<number>
): Candidate | null {
  let fallback: Candidate | null = null
  for (const candidate of candidates) {
    if (visited.has(candidate.title)) continue
    const lead = candidate.sharedEntities[0]
    if (lead === undefined || !followed.has(lead)) return candidate
    fallback ??= candidate
  }
  return fallback
}

/**
 * Up to `steps` steps from `start`. `shouldStop` is asked before each step
 * after the first, so a walk past its time budget returns what it has rather
 * than nothing.
 */
export async function walkSteps(
  start: number,
  steps: number,
  candidatesFrom: (title: number, visited: ReadonlySet<number>) => Promise<readonly Candidate[]>,
  visitedBefore: Iterable<number> = [],
  shouldStop: () => boolean = () => false
): Promise<WalkStepChoice[]> {
  const visited = new Set<number>([start, ...visitedBefore])
  const followed = new Set<number>()
  const walked: WalkStepChoice[] = []
  let current = start
  while (walked.length < steps) {
    if (walked.length > 0 && shouldStop()) break
    const next = chooseWalkStep(await candidatesFrom(current, visited), visited, followed)
    if (!next) break
    walked.push({ from: current, to: next })
    visited.add(next.title)
    if (next.sharedEntities[0] !== undefined) followed.add(next.sharedEntities[0])
    current = next.title
  }
  return walked
}
