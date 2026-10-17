# Staying in step with upstream

This fork ([aka-charos/aperture](https://github.com/aka-charos/aperture)) tracks [dgruhin-hrizn/aperture](https://github.com/dgruhin-hrizn/aperture) by cherry-pick, not by merge. This page explains why GitHub's "commits behind" figure is misleading and how to see the real gap.

## Why GitHub says "668 commits behind"

GitHub's ahead/behind counter compares commit identities. This fork's history split from upstream's on 2026-01-10, and upstream's work has reached `dev` as copies with different hashes, never as merges. So every upstream commit since the split counts as "behind", even when its change is already here.

As of 2026-10-17 the counter reads 668 behind: 576 ordinary commits plus 92 merge commits.

## The real gap

Compare by change instead of by hash:

```bash
git fetch upstream
git cherry -v dev upstream/main
```

A `-` line is a change already on `dev`; a `+` line is not. On 2026-10-17, **568 of the 576 were `-`**. The eight `+` commits are all from upstream's v0.7.9 and v0.7.10 releases of 2026-09-18, and none are merged here:

- a startup warning when the backup client and database server are on different PostgreSQL majors (this fork carries its own version of it)
- PostgreSQL 17 migration tooling and rewritten backup guidance
- two fixes to restore progress reporting
- a CI fix to publish images on release tag pushes
- the `0.7.9` and `0.7.10` version bumps

## Why not merge

Merging `main` into `dev` would zero the counter but conflicts in about 490 files, and `dev` is this fork's real main line and is never overwritten. Upstream changes come in one at a time:

```bash
git cherry-pick -x <commit>
```

Then adapt the result to the fork's conventions before pushing. The counter will keep growing as upstream commits; `git cherry` is the number to watch.

See also [fork-divergence.md](fork-divergence.md), which classifies every commit this fork carries over upstream.
