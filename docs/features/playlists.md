# Playlists

Playlists are **AI-generated recommendation lists** — you describe the vibe, Aperture picks the titles, and the finished playlist lands in your Emby/Jellyfin server, visible **only to you**. For a list everyone sees, build a [Collection](collections.md) instead.

## Accessing Playlists

Navigate to **Playlists** in the sidebar (playlist icon).

---

## Two Kinds of Playlist

| | **AI playlists** | **Similarity playlists** |
|---|---|---|
| Created by | You, with the recommender picking items | The [Media Graph](explore.md) or the [AI assistant](ai-assistant.md) |
| Card badge | Genre chips + seed count + "Updated …" | **Similarity** badge |
| Editable | Regenerate via preview; add/remove items by hand | View and delete only |

---

## Creating an AI Playlist

1. Click **New Playlist** and describe it:
   - **Genres** to match
   - **Media** — Movies, TV shows, or Both
   - **Seed titles** — "movies that define this playlist's vibe"; they steer generation, and an *Include the seed titles* toggle decides whether they're also *in* it
   - **Preferences** — free text ("Dark atmosphere, morally complex characters, twist endings…")
2. The sparkle buttons generate the preferences, name, or description for you — and when there's already text in the box, they offer **"Build on what I wrote"** instead of overwriting it
3. Save — the playlist exists, empty, until you generate

## Generating: Preview, Then Approve

Click a card's generate/refresh button and nothing is written yet — a **preview** opens first:

- Every proposed title carries an **AI-written one-line reason** for why it fits
- Remove anything you don't want
- Confirm with **"Add N titles"** — exactly the approved set is pushed to your media server

Refreshing re-runs the same preview, so the server copy never changes without your approval.

## Managing an AI Playlist

- **View** — the full list, with reasons
- **Add manually** — a search box in the view dialog ("Add Movie to Playlist")
- **Remove** — per item from the view dialog
- **Edit settings** — genres, seeds, preferences
- **Delete** — removes the playlist from Aperture *and* from your media server
- **Show on my Emby home screen** — on Emby, tick **Also show it on my Emby home screen** and the playlist becomes a row on your home screen after the next home-screen sync (only you see it, and the row isn't kept in playlist order). Your admin has to have playlist rows switched on; see [Emby Home Screen](user-settings/home-screen.md)

---

## Similarity Playlists

Created from elsewhere and view-only:

- **From the Media Graph** — explore, then **Create playlist** to bundle the current items ("Create Playlist from Graph")
- **From chat** — assistant answer carousels offer **Create Playlist from Suggestions**, pre-selecting the titles it recommended

Either way the dialog lists the items (adjustable at creation), and can generate a name and description with AI. The playlist is created on your media server too. A playlist made from chat suggestions can also go on your Emby home screen; one made from the Media Graph can't.

---

## Tips

- **Seeds beat genres** — three seed films describe a mood better than any keyword
- **Build on what you wrote** — a bad first generated description is worth one more try with your own additions
- **The reasons matter** — read the preview reasons before approving; they're the model telling you what it thinks you asked for

---

**Next:** [Collections](collections.md)
