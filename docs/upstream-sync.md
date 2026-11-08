# Staying in step with upstream

This fork ([aka-charos/aperture](https://github.com/aka-charos/aperture)) tracks [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture) by cherry-pick, not by merge. This page explains why GitHub's "commits behind" figure is misleading and how to see the real gap.

## Why GitHub says hundreds of commits behind

GitHub's ahead/behind counter compares commit identities. This fork's history split from upstream's on 2026-01-10, and upstream's work has reached `dev` as copies with different hashes, never as merges. So every upstream commit since the split counts as "behind", even when its change is already here.

As of 2026-11-08 the counter reads 780 behind `upstream/main` (at v1.0.2): 635 ordinary commits plus 145 merge commits.

## The real gap

Compare by change instead of by hash:

```bash
git fetch upstream
git cherry -v dev upstream/main
```

A `-` line is a change already on `dev`; a `+` line is not. On 2026-11-08, **568 of the 635 were `-` and 67 were `+`**. The gap was eight commits on 2026-10-17; upstream's run to v1.0.0 added 49, and v1.0.1 to v1.0.2 the last ten. None of the 57 has been merged as is. A read-through on 2026-11-06 of these and the two `upstream/dev` commits below sorted them as 10 already covered, 1 to cherry-pick, 8 to adapt and 40 to skip. The first five items from that list are listed under "Taken in part" below.

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

From upstream's v1.0.1 and v1.0.2, 2026-11-05 to 2026-11-07 (10 commits; `upstream/dev` is now level with `main`):

- `b0b0f684`: Encore response styles (Quick, Standard, Expanded), its own reasoning-effort mapping, and OpenAI-priced cost estimates with measured Encore usage
- `7dbcd1e2`: a large release commit that also carries fixes to restore, gap analysis, series sync, the Explore graph and Jellyfin libraries
- `e44278d2`, `1f84b741`, `be7a5fdc`: Emby publishing load (a request deadline covering the body, a per-server cap, a refresh queue)
- `7ecb45e3`: registered next-run times and schedule minutes kept
- `270a5b9d`, `7ce960d2`: STRM and symlink output guidance and a **Check output compatibility** action, plus a documentation refresh
- release chores (`1a23dbc3`, `bb71a1b1`)

### Taken in part

`git cherry` matches exact patches, so a change adapted by hand still shows as `+`. That covers some of the list above:

- **Adapted:** the watch-history catalog, upcoming episodes, Browse watcher filters and Browse People ([F-178](aperture-forensics.md#f-178)), and Discovery's loading from `0deb5396` and `9d0bc194` ([F-179](aperture-forensics.md#f-179)). Each was measured here first, and parts were left out.
- **Adapted, fixes:** the library switch from `728678a6`; restore in one transaction, stopping on a failed safety backup, and its progress token and page, from `7dbcd1e2`, `12b81a67` and `f596aa0f` ([F-187](aperture-forensics.md#f-187)); safer library cleanup and smaller episode pages from `7dbcd1e2` ([F-188](aperture-forensics.md#f-188)); the Watching cache's owner, from `9cac3a0f`, and the image proxy's deadline, from `626a68f9` and `d5b918fb` ([F-189](aperture-forensics.md#f-189)).
- **One idea kept:** keying the once-per-build chunk reload on the entry's URL, from `9cac3a0f`; its cancelling of `vite:preloadError` was rejected ([F-174](aperture-forensics.md#f-174)).
- **Adapted, runtime:** Node 24 from `67e00c4f`, with the PostgreSQL client pinned to **18** (checked at build time) rather than upstream's 17 (`66604fb9`, `1daeb457`, which this fork had taken and reverted in `3e566f14`). PostgreSQL's source shows `pg_dump` refuses only a server newer than itself, so upstream's note that an 18 client refuses a 16 or 17 server is wrong; and 17 and 18 write the same archive format, so 18 reads every backup the floating client already wrote here. See `docker/Dockerfile` and [backup and restore](admin/backup-restore.md).
- **One idea kept:** Browse cancelling an older list request and ignoring its late reply, from `9cac3a0f`, built on the web app's existing request guard (`pages/browse/hooks/listRequests.ts`). Its other loading changes were already covered here or not needed.
- **One idea kept:** a model's `\'` repaired before the strict JSON parse, from `e50729c6`, as core `lib/modelJson.ts` (`parseModelJson`), used by the explanation parser and Discovery's free-text candidate fallback. The rest of its parser was already covered by `explanationParsing.ts`'s salvage, and its localised NFO headings serve legacy library output.
- **Solved separately:** an instance reached by an address other than `APP_BASE_URL`, the ground `26150c86` covers ([F-176](aperture-forensics.md#f-176)).
- **Measured and not ported:** the recommendation-query rewrite in `5d76c020` ([F-180](aperture-forensics.md#f-180)).
- **Adapted, from 1.0.1:** the media-server request deadline that covers the body, and the per-server request cap, from `e44278d2`; the schedule minute kept on save, spread default minutes, and the next run decided in the scheduler's zone, from `7ecb45e3` and `e44278d2` ([F-191](aperture-forensics.md#f-191)). Then media-server jobs taking turns, from `e44278d2`, and the Search page showing title matches before semantic ones and dropping stale answers, from `7dbcd1e2` ([F-192](aperture-forensics.md#f-192)). Its Emby refresh queue and incremental STRM writing (`e44278d2`, `1f84b741`, `be7a5fdc`) and output checks (`270a5b9d`, `7ce960d2`) serve legacy library output and were not taken.
- **From v0.8.0-dev.8 (`ebc75ac6`):** Emby libraries removed by id through `POST /Library/VirtualFolders/Delete`, the documented call (Jellyfin keeps its delete by name); the removal plan carries each library's id. Suggested replies under the newest answer, built differently: upstream has the chat model call a tool at the end of its turn, which here would spend a step of the chat's budget and keep the turn running; this fork asks for them after the turn, with one short Text Generation call over the saved question, answer and card titles (`apps/api/src/routes/assistant/nextReplies.ts`). Its Encore web search and phone styling belong to Encore; its health check change was already covered by `healthcheck.ts`; its library-title tags serve legacy library output.
- **From v0.8.0-dev.8.1 (`49ab0c8f`):** the assistant finds a named title without its leading article or with a small typo, title matches ranked before synopsis matches. Built on this fork's library-search keys (`0178`, `aperture_search_key`, trigram indexes) rather than upstream's inline SQL, for both `searchContent` and `getContentDetails`, which also now compares films and shows and reads the viewer's scope in SQL (`helpers/titleSearch.ts`). Its single-result phone card targets Encore's own card component and was not taken.
- **Read and not taken, v0.8.0-dev.8.2 to v1.0.2:** Encore's card actions (`7102ec9d`) and phone layouts (`706116c9`), the 1.0.0 welcome-tour redesign (`a9505a99`), its phone layout pass over upstream's own shell (`a37f3aa1`) and the Play Iris artwork (`fadea8d2`), and the response styles of `b0b0f684`. Each targets Encore or upstream's own components; this fork has its own onboarding, layout and per-model reasoning settings.
- **From v0.8.0-dev.8.3 (`52b74472`):** the Chat role's Test asks for one streamed tool call and passes only on a valid one (`lib/chatToolTest.ts`), for every provider, Test only (upstream also gates Save, for OpenAI-compatible). Not taken: its live OpenAI model list (OpenAI-compatible and LM Studio already list live models here), Encore's release schedule and relative release windows, and v0.8.0-dev.8.2's Encore card actions.

## Why not merge

Merging `main` into `dev` would zero the counter but conflicts in 583 files (a dry run on 2026-11-06), and `dev` is this fork's real main line and is never overwritten. Upstream changes come in one at a time:

```bash
git cherry-pick -x <commit>
```

Then adapt the result to the fork's conventions before pushing. The counter will keep growing as upstream commits; `git cherry` is the number to watch.

See also [fork-divergence.md](fork-divergence.md), which classifies every commit this fork carries over upstream.
