# Staying in step with upstream

This fork ([aka-charos/aperture](https://github.com/aka-charos/aperture)) tracks [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture) by cherry-pick, not by merge. This page explains why GitHub's "commits behind" figure is misleading and how to see the real gap.

## Why GitHub says hundreds of commits behind

GitHub's ahead/behind counter compares commit identities. This fork's history split from upstream's on 2026-01-10, and upstream's work has reached `dev` as copies with different hashes, never as merges. So every upstream commit since the split counts as "behind", even when its change is already here.

As of 2026-11-06 the counter reads 763 behind `upstream/main`: 625 ordinary commits plus 138 merge commits.

## The real gap

Compare by change instead of by hash:

```bash
git fetch upstream
git cherry -v dev upstream/main
```

A `-` line is a change already on `dev`; a `+` line is not. On 2026-11-06, **568 of the 625 were `-` and 57 were `+`**. The gap was eight commits on 2026-10-17; upstream's run to v1.0.0 added the other 49. None of the 57 has been merged as is. A read-through on 2026-11-06 of these and the two `upstream/dev` commits below sorted them as 10 already covered, 1 to cherry-pick, 8 to adapt and 40 to skip. The first five items from that list are listed under "Taken in part" below.

From upstream's v0.7.9 and v0.7.10 releases of 2026-09-18 (8 commits):

- a startup warning when the backup client and database server are on different PostgreSQL majors (this fork carries its own version of it)
- PostgreSQL 17 migration tooling and rewritten backup guidance
- two fixes to restore progress reporting
- a CI fix to publish images on release tag pushes
- the `0.7.9` and `0.7.10` version bumps

From upstream's work towards v1.0.0, 2026-11-03 to 2026-11-05 (49 commits):

- **Encore**, a rebuilt assistant workspace: lasting memory, watch plans, approved Emby actions, opt-in recurring curation and web grounding, and its tools shared with MCP clients
- **Emby output**: AI picks as private native playlists, picks that rotate, permission-aware TV groups, pinning on the Emby home screen, and a Tonight screen with "Not tonight" snoozes
- **Recommender**: enriched keywords in the ranking, reserved quality-filtered exploration picks, taste ratings normalised on the ten-point scale, and recovery of Ollama's explanation JSON
- **Interface**: a persistent mobile app shell with a floating dock, optional Studio light and dark themes, and a redesigned welcome tour
- **Fixes and speed**: scoped access on Emby 4.10, LAN and reverse-proxy access, runtime input contracts across the API, and faster Discover, UI loading and upcoming episodes
- release and version chores

`upstream/dev` is two ordinary commits past that, at 1.0.1-dev.2, which the command above does not list. `b0b0f684` adds Encore response styles. `7dbcd1e2` is a large release commit that also carries fixes to restore, gap analysis, series sync, the Explore graph and Jellyfin libraries.

### Taken in part

`git cherry` matches exact patches, so a change adapted by hand still shows as `+`. That covers some of the list above:

- **Adapted:** the watch-history catalog, upcoming episodes, Browse watcher filters and Browse People ([F-178](aperture-forensics.md#f-178)), and Discovery's loading from `0deb5396` and `9d0bc194` ([F-179](aperture-forensics.md#f-179)). Each was measured here first, and parts were left out.
- **Adapted, fixes:** the library switch from `728678a6`; restore in one transaction, stopping on a failed safety backup, and its progress token and page, from `7dbcd1e2`, `12b81a67` and `f596aa0f` ([F-187](aperture-forensics.md#f-187)); safer library cleanup and smaller episode pages from `7dbcd1e2` ([F-188](aperture-forensics.md#f-188)); the Watching cache's owner, from `9cac3a0f`, and the image proxy's deadline, from `626a68f9` and `d5b918fb` ([F-189](aperture-forensics.md#f-189)).
- **One idea kept:** keying the once-per-build chunk reload on the entry's URL, from `9cac3a0f`; its cancelling of `vite:preloadError` was rejected ([F-174](aperture-forensics.md#f-174)).
- **Solved separately:** an instance reached by an address other than `APP_BASE_URL`, the ground `26150c86` covers ([F-176](aperture-forensics.md#f-176)).
- **Measured and not ported:** the recommendation-query rewrite in `5d76c020` ([F-180](aperture-forensics.md#f-180)).

## Why not merge

Merging `main` into `dev` would zero the counter but conflicts in 583 files (a dry run on 2026-11-06), and `dev` is this fork's real main line and is never overwritten. Upstream changes come in one at a time:

```bash
git cherry-pick -x <commit>
```

Then adapt the result to the fork's conventions before pushing. The counter will keep growing as upstream commits; `git cherry` is the number to watch.

See also [fork-divergence.md](fork-divergence.md), which classifies every commit this fork carries over upstream.
