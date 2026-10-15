# Emby Home Screen

On Emby, Aperture can add rows to your own **Emby home screen**: your recommendations, the server's Top Picks, what your connections recommended to you, and playlists you choose. The **Emby home screen** tab of your settings is where you see those rows, switch any of them off, and decide where they go.

## Accessing

Click your **avatar** in the top bar, open your settings, and pick the **Emby home screen** tab. It's there for Emby accounts only. If your admin hasn't switched home-screen rows on, the tab says so and there's nothing to set.

---

## How the Rows Work

The rows point at the titles already in your library, so nothing is copied: playing from a row plays the real item and marks it watched as usual. You'll find them on every Emby app you sign in to (TV, phone, web), alongside your own Emby rows.

Titles inside a row are sorted by a field your admin chose (random, by title, recently added, and so on), not by recommendation rank, because Emby can't keep a custom order in a row.

---

## The Rows

| Row | What's in it |
|-----|--------------|
| **Top Picks: Movies** / **Top Picks: Series** | The most popular titles on the server right now; the same list for everyone (see [Top Picks](../top-picks.md)) |
| **Movie recommendations** / **Series recommendations** | Your own picks, from your latest recommendation run (see [My Recommendations](../recommendations.md)) |
| **Recommended by friends** | Titles your connections sent you on [Watch This](../watch-this.md); a title leaves when you finish or dismiss it |
| **Generated playlists** | Each playlist or collection you generated, or playlist you made from assistant suggestions, that you switched on becomes a row of its own |

Your admin decides which kinds of row exist and what they're called. Each card on the tab says whether the row is on your home screen, how many titles it holds, and shows a strip of them. A row that can't reach you says why: switched off by your admin, recommendations switched off for your account, no library of that kind you can open, or nothing in it yet (it appears once there is).

---

## Switching Rows On and Off

Each row has a **Show … on my home screen** switch. Your choice is kept even when the row is unavailable, so if your admin switches a row back on later, it stays off for you.

For playlists, the card lists every playlist that can go on your home screen; switch on the ones you want. A playlist that hasn't been generated yet has to be generated on the [Playlists](../playlists.md) page first. You can also tick **Also show it on my Emby home screen** on the playlist itself.

## Choosing Where Rows Go

Each kind of row follows your admin's default placement until you pick **My own placement**:

- **Top** or **Bottom** of your home screen
- A **position number** (how many of your rows sit above it, 0 = top)
- **After** or **before** one of your existing rows, such as Continue Watching

Press **Apply**. Changes reach Emby straight away; if Emby can't be reached, they're saved and applied at the next sync. A row is only moved when it's first created or when its placement changes, so if you drag a row somewhere else in Emby, it stays where you put it.

## The Preview

**Your Emby home screen** shows your whole home screen top to bottom, as it will look with your choices applied. Aperture's rows are highlighted; the rest are your own Emby rows.

---

**Related:** [Preferences](preferences.md) · [Watch This](../watch-this.md) · [Playlists](../playlists.md)
