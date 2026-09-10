# Aperture — agent instructions

The complete, actively maintained **repo map lives in `CLAUDE.md` at the repository root**. It is the source of truth for architecture, repo-wide invariants, commands, database layout, feature→file cross-references, and naming traps.

**Before making any change, read `CLAUDE.md` — at minimum the sections relevant to what you're touching** (the "Feature → files cross-reference" and "Naming traps" sections prevent most wrong-file edits). When you add, move, or rename a route, page, core module, or table, update the relevant section of `CLAUDE.md` in the same change; stale entries cause wrong-file edits.

## 30-second orientation (digest only — details in `CLAUDE.md`)

- pnpm monorepo, ESM, raw SQL via `pg` (no ORM). `packages/core` holds all domain logic; `apps/api` is a thin Fastify layer (port 3456); `apps/web` is a Vite + React 18 SPA (port 3457); `packages/ui` is shared React components; `db/migrations/` holds numbered SQL migrations.
- `pnpm dev` / `pnpm typecheck` / `pnpm lint` / `pnpm db:migrate`. After changing any export in `packages/core` or `packages/ui`, run `pnpm --filter "./packages/*" build` or app typecheck fails.
- The web bundle never imports `@aperture/core`. Parallel implementations (`movies/` vs `series/`, `emby/` vs `jellyfin/`) must be mirrored — a fix in one usually needs the other.
- All integration config lives in `system_settings` (via `core/src/settings/systemSettings.ts`), never read from env directly.
