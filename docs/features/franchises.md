# Franchise Tracker

The Franchise Tracker shows the **movie collections** in your library — Marvel, Middle-earth, James Bond — and your progress through each one.

## What Counts as a Franchise

A franchise is a **movie collection** — the TMDb collection metadata attached to your files (populated by the metadata enrichment job). Trilogies, universes, and box sets all show up as long as your titles carry collection data. This page is movies-only; series don't form franchises.

Until the enrichment job has run, the page is empty and tells you so.

---

## Accessing the Tracker

1. Open `/franchises` — the tracker isn't in the sidebar, so go to it by address (in the in-app guide, the address above is a link)
2. Or use the **Franchise filter** on [Browse](browse.md) → Movies to jump straight to one franchise's titles

---

## The List

Franchises appear as **expandable cards**:

- A **poster strip** of the collection's entries
- The franchise name, with a **Complete** chip at 100%
- **"X / Y movies watched"** and a percentage chip
- A **progress bar**

A title counts as watched when it's actually been played (a favorite that was never played doesn't count).

The page header totals your collection habit: **Franchises**, **Completed**, **Total Movies**, **Overall Progress**.

### Organizing the List

- **Search** franchises by name
- **Sort by** — Most Movies, Name, Progress, or Most Unwatched
- **Show / Hide completed** — hide the ones you've finished
- Long lists load as you scroll, with "Showing X of Y franchises" keeping count

### Expanding a Franchise

Open a card to see its movies as a poster grid — each with its watched tick and your star rating, so you can see exactly which entry you're missing. The grid is the answer to "what's next in this collection?".

---

## A Franchise Page

Click a franchise's **name** (or **Part of Collection** on any movie's detail page) to open its own page, which lists the **whole** collection, including the films you don't have:

- A summary: how many films, how many are in your library, and how many you've watched
- **In your library** — the films you have, each with its watched tick
- **Not in your library** — released films the server doesn't have, with a **Request** button when Seerr is set up and your account may request (otherwise it says why not). A film already requested shows its request status instead
- **Upcoming** — announced films with their release date (or "Release date not announced"); these can't be requested yet

If TMDb can't be reached, only the films already in your library are listed, and the page says so. Requests made here appear under [My Requests](my-requests.md).

---

## Franchises and Recommendations

Your franchise habits feed your recommendations, and you can adjust them in [Recommendations settings](user-settings/recommendations.md#franchises):

- The **Franchises** card lists the franchises found in your viewing, each with a slider from **Avoid** through **Neutral** to **Boost**
- Removing a franchise is the "I'm done with this one" control: it stops counting entirely
- **Franchise size** and **Watched by you** decide which franchises are listed at all (for example, only collections with at least 2 titles in the library, of which you've watched at least 1)

Completing a franchise is a real signal: rate its entries well and similar collections rise in your recommendations.

---

**Next:** [Person Pages](person-pages.md)
