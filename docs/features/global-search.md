# Global Search

Search your library for movies and series — from a quick palette in the header, or a full search page with filters and an optional AI semantic mode.

## Two Ways to Search

### The Search Palette

Click the **search icon** in the top bar (or press **⌘K** / **Ctrl+K**):

- Results appear as you type (after two characters): posters, title, year, and a Movie/Series chip
- **↑↓** to navigate, **↵** to open, **Esc** to close
- **"View all results for … →"** takes you to the full search page

The palette returns **movies and series**. It matches the title and original title first, ignoring accents and punctuation ("amelie" finds *Amélie*, "dont look up" finds *Don't Look Up*), and also finds a title by its cast, director, keywords or synopsis — so typing an actor's name lists their films, ranked below titles that match by name. It never lists people or franchises themselves; use [Browse](browse.md)'s People tab or the [Franchise Tracker](franchises.md) for those. If the search itself fails, it says so rather than showing "No results".

### The Search Page

Open the full **Search** page for a bigger set of tools:

- **Type filter** — All / Movies / Series
- **Genre, Franchise, and Network** filters
- **Min RT Score** and **Year range** sliders
- Results as a poster grid with your ratings and watch badges

### Not in the library?

If you can request titles, both the palette and the Search page also check your Seerr catalog for what you typed. When it finds films or shows that aren't on your server and nobody has requested yet, a line under the search box says how many (for example *"4 films and 2 TV shows matching "aftersun" are not on …"*) with **Request what you can't find**. That opens [My Requests](my-requests.md) with the same search already filled in, so you can request them there. In the palette, the line is part of the arrow-key order, between **View all results** and the first result.

Your library results never wait for this: they appear as usual, and the line slides in a moment later, once Seerr answers. If Seerr isn't set up or doesn't answer, the line simply doesn't appear. "At least" means Seerr has more pages of results than the first one counted.

---

## AI Search

The Search page has an **AI Search** toggle (opt-in per search, requires embeddings to be enabled):

- **Off** — word matching: titles first (with fuzzy matching for typos), then cast, crew, keywords and synopsis
- **On** — results also use **semantic matching**, so *"mind-bending sci-fi"* finds the right shelf even though no title contains those words. Matching results are marked *(with AI-powered semantic matching)*. If the semantic answer takes more than a moment, the title matches show first, dimmed, and are replaced when it arrives; if it fails, the title matches stay with a note

The header palette always searches literally; switch to the full page and toggle AI Search for concept-style queries.

---

## Search Tips

| Looking for | Do this |
|-------------|---------|
| A specific title | Type it — partial titles work ("dark knight") |
| A concept or mood | Full page → **AI Search** on ("time travel romance") |
| An actor or director | Type their name to list their titles, or open their page from [Browse](browse.md) → People |
| A franchise | [Franchise Tracker](franchises.md), or the Franchise filter on Browse → Movies |

---

## What About the AI Libraries?

If your server still uses the generated AI Picks and Top Picks libraries (a legacy feature, off on new installs), they are marked **excluded from search** on the media server itself, so titles don't double up. Aperture's search runs against your real libraries either way, and only the ones your account can open.

---

**Next:** [Browse Movies & Series](browse.md)
