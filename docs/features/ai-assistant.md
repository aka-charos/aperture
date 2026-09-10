# AI Assistant (Encore)

**Encore** is Aperture's built-in AI assistant. Ask in plain language and it searches your library, your history, your stats, and — for discovery requests — the web, answering with poster cards you can act on.

![Dashboard showing AI features](../images/features/dashboard.png)

## Opening the Assistant

- The **sparkle button** (bottom-right, on every page) opens the assistant as a **side panel** you can drag to resize (400–720px wide)
- It's also a full **page** in the sidebar (**Assistant**), where your conversations live
- Conversations are **saved server-side** — close the panel or reload the page and they're still there, fully rendered; old conversations can be deleted from the sidebar page

---

## What It Can Do

### Find things in your library

> "What should I watch tonight?"

> "I want something like Inception but less confusing"

> "A slow, wintry film — nothing longer than two hours"

Concept queries are answered with **semantic search** over your library's embeddings, not just title matching. Answers arrive as **poster card carousels**, each with a reason attached. Cards carry **Play on Emby/Jellyfin** and favorite actions, so you can go from answer to playback without leaving the chat.

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

Missing titles can be **requested** straight from the cards (via Seerr). While it works, a **status line** narrates the phase — "Searching your library…", "Scouting for candidates…", "Writing up why each fits…" — so you're never staring at a spinner.

### Build playlists from answers

A suggestion carousel has a **create-playlist** action: the titles it recommended become a playlist, with the chat's request and reasons feeding the playlist's own generation. See [Playlists](playlists.md).

---

## A Worked Example

**You:** "I'm in the mood for something scary but not too gory"

> *Status: Searching your library…*

**Encore:** carousel of atmospheric horror from your library — each card with a one-line reason ("slow-burn haunted-house dread, minimal gore"), a **Play on Emby** button, and the watched titles omitted because "Only suggest what I haven't watched" is on.

**You:** "okay but something newer, this century only"

**Encore:** a refreshed carousel (it remembers the thread), plus — because this is now a *discovery* request for titles you may not have — a second section, **"Also worth checking"**, with library neighbours of the strongest pick.

**You:** "is there anything like this streaming that we don't have?"

> *Status: Scouting for candidates…*

**Encore:** a **Recommendations** section of web-sourced titles with grounded reasons, each card carrying a **Request** button. Anything requested shows up later under [My Requests](my-requests.md).

---

## Good to Know

- **It can't rate for you** — ratings stay a manual action (deliberately: a rating is your judgement)
- **It can't play directly** — play buttons open the title in your media server
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

**Next:** [Preferences](user-settings/preferences.md)
