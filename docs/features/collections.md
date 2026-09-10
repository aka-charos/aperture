# Collections

**Collections** (sidebar) builds **Emby/Jellyfin collections** — the box-set-style groupings that appear in your library for **everyone** to see. For something only you can see, build a [Playlist](playlists.md) instead.

Both features share the same editor and workflow; the difference is where the result lands and who can see it:

| | [Playlists](playlists.md) | Collections |
|---|---|---|
| Created in your media server as | A playlist | A collection (box set) |
| Visible to | Only you | Everyone with access to the library |
| Managed from | The Playlists page | The Collections page |

Access to the Collections page is granted by your administrator (it's available to admins by default, and can be enabled per user).

---

## Building one

1. **Describe it** — pick genre filters, write a free-text brief (e.g. *"slow-burn 70s paranoia thrillers"*), optionally add **seed titles** that steer the result, and choose movies, TV shows, or both. AI buttons can generate the brief, the name, and the description for you; when there's already text in the box, the sparkle button offers **"Build on what I wrote"** instead of starting fresh.
2. **Preview** — nothing has been written to your media server yet. Each proposed title carries an AI-written one-line reason for why it fits; remove anything you don't want.
3. **Approve** — exactly the set you approved is pushed to the media server as a collection.

---

## Day-to-day

- **Refresh** re-runs generation through the same preview — you approve before anything on the server changes.
- **Editing the description** only updates the collection's overview text on the server; it never rewrites the item list.
- **Renaming** a collection builds the new box set but does not find and remove the one under the old name — delete the old one from your media server if it lingers.
- **Deleting** the collection in Aperture also removes the server-side collection.

Both features are powered by the same pipeline (Aperture's *channels*); the only difference is the output type and its visibility.
