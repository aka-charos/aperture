# AI Assistant (Encore)

**Encore** is Aperture's built-in AI assistant. Ask in plain language and it searches your library, your history, your stats, and — for discovery requests — the web, answering with poster cards you can act on.

## Opening the Assistant

- The **sparkle button** (bottom-right, on every page) opens the assistant as a **side panel** you can drag to resize (400–720px wide)
- It's also a full **page** in the sidebar (**Assistant**), where your conversations live
- Conversations are **saved server-side** — close the panel or reload the page and they're still there, fully rendered; old conversations can be deleted from the sidebar page
- Every message costs model calls, so an admin can switch the assistant off for particular accounts; if you don't see the sparkle button or the **Assistant** page, it's off for yours
- It only ever shows titles from the libraries your account can open

---

## What It Can Do

### Find things in your library

> "What should I watch tonight?"

> "I want something like Inception but less confusing"

> "A slow, wintry film — nothing longer than two hours"

Concept queries are answered with **semantic search** over your library's embeddings, not just title matching. Answers arrive as **poster cards**, each with a reason attached, in a grid that fits the width of the chat. Click a card, its title, or **More ›** at the end of a cut synopsis to open the title (playback starts there); each card also has a favorite toggle, and an episode card has **Play**, which opens that episode directly.

### Answer questions about *you*

> "How many Marvel movies have I watched?"

> "What did I rate highest last year?"

> "The French noir I watched this spring?"

It can read your history (including by genre, country, or rating), your ratings, your stats, and your taste profile. Turn on **"Only suggest what I haven't watched"** — a persistent checkbox — and every suggestion filters out everything you've seen.

### Find people and episodes

> "What else has Denis Villeneuve directed?"

> "Which episode of The X-Files is the one with the carnival?"

Person lookups return **person cards**; where episode embeddings are enabled, episode-level search finds individual episodes and links to their series.

### Discover what you *don't* have

For "find me something new" requests, the assistant searches **web sources** (Google grounding, Tavily) alongside your library and combines the results. A discovery answer comes in up to three sections:

1. **Recommendations** — the web picks, each with a grounded reason
2. **Also worth checking** — neighbours of a seed title from your own library
3. **From your taste profile** — scored library matches for your exact words

When an answer has more than one section, they appear as **tabs** labelled with how many titles each holds; only sections that found something get a tab.

Missing titles can be **requested** straight from the cards (via Seerr). While it works, a **status line** narrates the phase — "Searching your library…", "Scouting for candidates…", "Writing up why each fits…" — so you're never staring at a spinner.

### Talk about a film's analysis

> "What do critics say about how Suspiria was made?"

If a title has a stored [Film Analysis](title-analysis.md), the assistant can read it to you or answer from it. It never writes a new one in chat; where none exists it says so. Parts of an analysis that may give away how a film ends are held behind a disclosure.

### Build playlists from answers

A suggestion carousel has a **create-playlist** action: the titles it recommended become a playlist, with the chat's request and reasons feeding the playlist's own generation. See [Playlists](playlists.md).

---

## A Worked Example

**You:** "I'm in the mood for something scary but not too gory"

> *Status: Searching your library…*

**Encore:** carousel of atmospheric horror from your library — each card with a one-line reason ("slow-burn haunted-house dread, minimal gore"), opening the title when clicked, and the watched titles omitted because "Only suggest what I haven't watched" is on.

**You:** "okay but something newer, this century only"

**Encore:** a refreshed carousel (it remembers the thread), plus — because this is now a *discovery* request for titles you may not have — a second section, **"Also worth checking"**, with library neighbours of the strongest pick.

**You:** "is there anything like this streaming that we don't have?"

> *Status: Scouting for candidates…*

**Encore:** a **Recommendations** section of web-sourced titles with grounded reasons, each card carrying a **Request** button. Anything requested shows up later under [My Requests](my-requests.md).

---

## Good to Know

- **It can't rate for you** — ratings stay a manual action (deliberately: a rating is your judgement)
- **It can't play directly** — a card opens the title, and you play it from there
- **Discovery turns use the internet** — when the answer needs web sources, the request involves external services; library-only questions stay local
- **It doesn't guess watched state** — with "only unwatched" on, the filter is real: played titles and 5%+ progress are excluded
- **Welcome-screen suggestion chips** refresh with your latest recommendation run — a one-click way in

---

## Tips

- **Say what you're in the mood for, not a title** — "something slow and wintry" works better than genre names
- **Chain turns** — "more like the second one", "anything with the same director?", "now something lighter"
- **Ask it to justify** — "why this one?" gets you the reasoning behind a card
- **Use it for intersection questions** — the things Browse filters can't express ("the 90s comedies I rated 8+")

---

**Next:** [Recommendations settings](user-settings/recommendations.md)
