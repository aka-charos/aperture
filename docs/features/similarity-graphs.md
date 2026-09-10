# Related-Content Graphs

Every movie and series detail page shows **Related Movies / Related Series** — the same relationships drawn two ways: a **List** of posters and an interactive **Graph**.

![Movie Detail Page](../images/features/movie-detail.png)

## List and Graph

| Tab | Display |
|-----|---------|
| **List** | Poster cards with watch badges, your ratings, and **connection-reason chips** naming why each one relates |
| **Graph** | The same items as a poster network you can drag, zoom, and refocus |

The section shows a fixed set of the strongest connections (10 docked; the fullscreen graph reaches 12).

---

## The Graph

### Nodes and edges

- Nodes are posters; the item you're viewing and its primary relations render larger — size reflects role, not similarity
- Edge **width** scales with similarity; hover an edge for the exact percentage ("71% similar")
- Hover a node for title, year, type, and **"Connected via:"** reason chips
- **Click a node** to refocus the graph on it (breadcrumbs appear; **Start over** resets); **double-click or ⓘ** opens the detail page
- **Fullscreen** expands the graph to more items ("Expanded view • N items") — with its own create-playlist button

### Connection colors

One edge, one color — the strongest reason wins:

| Color | Connection |
|-------|-----------|
| **Blue** | Same director |
| **Teal** | Shared actor |
| **Gold** | Same collection |
| **Purple** | Genre match |
| **Pink** | Theme match |
| **Orange** | Same studio |
| **Green** | Same network |
| **Gray** | AI similar (embedding similarity) |
| **Emerald** | AI discovery |

---

## Settings

Two preferences live under [Preferences](user-settings/preferences.md) → Similarity Graph:

| Setting | Effect |
|---------|--------|
| **Hide Watched Content** | Related items you've seen don't appear |
| **Full Franchise Mode** | Keeps whole collections together instead of trimming to a representative few |

The section always opens on the List tab; your graph position resets per visit.

---

## From the Graph to a Playlist

In the fullscreen view, **Create playlist** opens the playlist dialog with the graph's items pre-filled — a quick way to turn "everything connected to this" into something your media server can play. See [Playlists](playlists.md).

---

## Related Graphs vs Media Graph

| | Related-content graph | [Media Graph](explore.md) |
|---|---|---|
| **Scope** | One title's connections | Your whole library, seeded by a description or list |
| **Depth** | One hop (refocus to hop again) | Unlimited wandering |
| **Best for** | "What's like this?" | Discovery sessions |

---

**Next:** [Shows You Watch](shows-you-watch.md)
