/**
 * The one place that knows what version this is.
 *
 * There were five hardcoded strings before this — `routes/api.ts` said 0.1.0
 * while `routes/health` said 0.7.8 and two OpenAPI examples said 0.7.8 again,
 * none of them agreeing with `apps/api/package.json`. Any version scheme
 * layered on top of that would have drifted the same way, so the scheme starts
 * here: everything reads these, nothing hardcodes a number.
 *
 * ## Why two fields rather than one string
 *
 * This is a FORK of dgruhin-hrizn/aperture. `version` is the upstream lineage —
 * "this is their 0.7.8" — and `build` identifies which fork build it is. Mashing
 * them into `0.7.8-mod.42` forces a SemVer precedence question with no good
 * answer: `-mod.42` is a *pre-release*, so it sorts BELOW plain 0.7.8, which is
 * backwards for something that is 0.7.8 plus work. `+mod.42` is build metadata
 * and semantically right, but `+` is illegal in a Docker tag. Keeping the two
 * apart sidesteps the argument entirely; `fullVersion()` still joins them with
 * `-` for the single-string surfaces, where the mis-sort costs nothing because
 * nothing resolves version ranges against this app.
 *
 * ## Where the values come from
 *
 * CI computes both and passes them as Docker build args (see docker-build.yml
 * and the Dockerfile). Outside a built image — `pnpm dev`, tests — the env vars
 * are unset and the fallbacks below apply.
 */

/**
 * Upstream version this fork tracks. CI overrides it from apps/api/package.json,
 * so this constant only matters for local dev; keep it in step with that file
 * when merging an upstream release.
 */
const FALLBACK_VERSION = '0.7.8'

/** Marks a build that did not come from CI, so a stray dev image is obvious. */
const LOCAL_BUILD = 'dev'

const envOr = (name: string, fallback: string): string => {
  const raw = process.env[name]?.trim()
  return raw ? raw : fallback
}

/** Upstream lineage, e.g. "0.7.8". Never carries fork information. */
export const APP_VERSION = envOr('APP_VERSION', FALLBACK_VERSION)

/**
 * Fork build identity, e.g. "mod.412.g730c57c" — `git describe` shape: commit
 * count for a monotonic build number, short SHA so it is unambiguous even
 * across a history rewrite. "dev" when not built by CI.
 */
export const APP_BUILD = envOr('APP_BUILD', LOCAL_BUILD)

/** True when this build came out of CI rather than someone's laptop. */
export const isReleaseBuild = APP_BUILD !== LOCAL_BUILD

/**
 * The single string for surfaces that only have room for one — health, the API
 * index, the OpenAPI document. A local build reports the bare upstream version
 * rather than "0.7.8-dev", which would read like a pre-release of upstream.
 */
export function fullVersion(): string {
  return isReleaseBuild ? `${APP_VERSION}-${APP_BUILD}` : APP_VERSION
}
