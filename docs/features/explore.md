# Media Graph

Media Graph (sidebar: **Media Graph**, hub icon) is a semantic exploration tool: describe what you're in the mood for, or pick one of your lists, and your library is drawn as a poster graph you can wander through.

![Explore Page](../images/features/explore.png)

## Accessing Media Graph

Navigate to **Media Graph** in the sidebar. It requires AI embeddings to be generated — your admin must have completed the AI setup.

---

## Starting a Graph

Two ways in:

### Search by description

Type what you're after — *"psychological thrillers"*, *"feel-good comedies"*, *"mind-bending sci-fi"* (the Try: chips are examples). Search by mood, theme, or description, not by title. Your recent searches are kept for one-click reuse.

### Browse one of your lists

**Browse by** seeds the graph from a list you already have: **My AI movie picks**, **My AI series picks**, **Shows you watch**, **Top picks movies**, **Top picks series**. The #1 item of a list is marked on its node.

While the graph builds, the page narrates what it's doing — searching your library, discovering themes, clustering, arranging.

---

## Reading the Graph

- **Nodes** are posters; the center/primary items render larger. Node size does *not* encode similarity
- **Edges** connect related items; hover an edge for the **similarity percentage**
- **Hover a node** for title, year, type, and **"Connected via:"** reason chips
- **Click a poster** to make it the new center (with breadcrumbs tracking your path); **click ⓘ** (or double-click) to open its detail page
- **Drag** to reposition, **scroll** to zoom

### Connection Colors

| Color | Connection |
|-------|-----------|
| **Blue** | Same director |
| **Teal** | Shared actor |
| **Gold** | Same collection |
| **Purple** | Genre match |
| **Pink** | Theme match (keywords) |
| **Orange** | Same studio |
| **Green** | Same network |
| **Gray** | AI similar (embedding similarity) |
| **Emerald** | AI discovery (deliberately diverse picks) |

The sidebar legend shows the same list live.

---

## Controls

| Control | What it does |
|---------|-------------|
| **Movies / Series / Both** | Filter the graph by media type |
| **Hide watched** | Drop titles you've already seen |
| **Show cross-media connections** | Let a film link to a resembling series and vice versa (browse views only; one slot per item is reserved for the other media type) |
| **Start over** | Reset to the initial graph |
| **Refresh** | Rebuild with current settings |

---

## Create Playlist

The header's **Create playlist** button takes the graph's current items and opens the playlist dialog with them pre-filled ("N items will be added") — name it, optionally generate a description, and it's created on your media server. See [Playlists](playlists.md).

---

## Media Graph vs Related-Content Graphs

| | Media Graph | [Related-content graphs](similarity-graphs.md) |
|---|---|---|
| **Where** | Its own page | Each detail page's Graph tab |
| **Seed** | A description or one of your lists | The title you're viewing |
| **Best for** | Open-ended discovery sessions | "What's connected to this one?" |

---

**Next:** [Related-Content Graphs](similarity-graphs.md)
