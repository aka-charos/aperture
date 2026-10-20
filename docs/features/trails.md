# Trails

Trails (sidebar: **Trails**, route icon; or **Follow a trail** on any title's page) lets you follow a trail through your library: start from a title, see the things it actually shares with the rest of your library — the people who made it, a franchise, a studio or network, an uncommon keyword — and step to the next title along one of them. Every link has a name, and every link says how many titles in your library share it, so you can tell a rare connection from a common one at a glance.

It is a separate page from the [Media Graph](explore.md). The Media Graph draws titles that an AI model judges similar and labels the lines afterwards; Trails draws no link that is not a named, shared credit.

---

## How links are weighed

- **Rarer links count for more.** A cinematographer who shot two films in your library links them far more strongly than a studio that distributed two hundred. The count under each link ("Only these two in your library", "5 titles in your library") is that rarity, stated plainly.
- **Roles count too.** Directing both titles is a stronger link than appearing in both, and sharing a keyword is weaker still. A person is one link whatever their role, so an actor who later directed connects the film they starred in to the one they made.
- **Very common things are left out.** A keyword, studio or person on a large share of your library stops being a reason and becomes a category, so it links nothing here. Genres and countries are never links.
- **Only your library counts.** Links, counts and titles are limited to the libraries you can open.

---

## Follow a trail

Pick a title to start from, or press **Surprise me** for a well-connected title chosen at random (under your filters, so it always has threads to show). Trails lists every named thread leading out of it, strongest first: each person, franchise, company or keyword it shares with the rest of your library, what it is in this title ("Director here"), how many titles carry it, and the titles that thread leads to (a person's titles are shown oldest first, like a filmography).

Press the **corner button** on any poster to follow that thread: that title becomes the next stop, and its own threads appear. A thread that leads to more titles than fit ends with "and 8 more"; **Show all** opens its whole list in place (a director's whole filmography here, say; a very long thread still stops after 200 titles and says how many more there are), and **Show fewer** closes it again.

### Your trail

Once you have taken a step, the titles you followed appear above the threads as **your trail**: posters joined by what links each to the next, with the person, franchise, company or keyword named between them. Press the corner button on an earlier poster to go back to it (the trail is cut there), or **Back to the start**. **Save as playlist** saves the trail, in order, as a playlist on your media server.

### Take me on a trail

**Take me on a trail** walks a few steps for you from the title you are on. Each step takes one of the strongest threads out of the current title to a title you haven't watched and that isn't already on your trail, and never follows the same person, franchise or keyword twice, so five steps lead somewhere rather than through one director's films. Press it again for a different walk: each step picks among the few strongest links, the strongest most often. If it runs out of new titles early, the page says how far it got.

### Filters

- **Hide what I've watched** leaves out the titles you have finished (the ones with a watched tick), and any thread that then leads nowhere. A show you are partway through still appears, and a title you mark watched while the filter is on drops off the threads already showing. How many titles carry a thread is not changed by it: hiding what you have seen does not make a link rarer.
- **Threads through** shows only the kinds you pick: **People**, **Franchises**, **Studios & networks**, **Keywords**. Pick none (or **Show every kind**) to see them all. *Take me on a trail* follows the same kinds.

---

## From a title's page

Every movie and series page has a **Follow a trail** button beside its other actions. It opens Trails starting from that title. Pressed from a title opened over another page, it closes the title's details and goes to Trails; pressed from a title opened over Trails itself, it starts a new trail there and keeps your filters.

Further down, below the cast and crew, a **Strongest links** card names the title's three strongest threads: who or what each is, what it is in this title ("Director here", "This title's franchise"), and how many other titles in your library share it. The link under the card (**See all 12 threads in Trails**, with the title's own count) opens the full list. A title with no named links shows no card, and its **Follow a trail** button goes once the page has checked (as the card's place scrolls into view); if Trails can't be reached, the card is simply left out.

---

## Everywhere on the page

- **Click a poster** to open the title's details over the page; closing them returns you where you were.
- Posters carry your **watched tick** or **episode count**, as everywhere else in the app.
- The page remembers your trail and filters in its address, so **Back** and a shared link both return to the same trail.

## Why a title has no trails

Trails reads the credits your server and the metadata enrichment provide: directors, writers, cinematographers, composers and editors (films), creators (series), the top-billed cast, TMDb franchises and keywords, studios and networks. A title missing those credits has nothing to link through. New titles appear on the page within the hour after they are synced.
