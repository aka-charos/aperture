# Preferences

The **Preferences** tab collects the settings that shape your day-to-day view of Aperture — and your account's connection to the outside world.

## Accessing Preferences

Click your **avatar** in the top bar and pick **Preferences** (the menu links the settings tabs directly). On Emby there's a fourth tab, [Emby home screen](home-screen.md), for the rows Aperture adds to your Emby home screen.

---

## Language

- **UI language** — pick Aperture's interface language
- **AI Summaries language** — the language AI-written text (explanations, identity prose) is written in, independent of the UI — useful when the household browses in one language but prefers its summaries in another
- When unset, the server default applies; your admin may restrict the offered languages

## AI Library Names

The names of your two AI Picks libraries in Emby/Jellyfin — "*YourName*'s AI Picks - Movies" and "- TV Series" by default. These libraries are a legacy feature, off on new installs; while your server doesn't write them, this card is greyed. Changes are used at the next library update, and a name another library already uses is refused. Keep names short (they show in TV menus). See [Virtual Libraries](../virtual-libraries.md).

## AI Explanation Preference

Whether each recommendation carries a **"Why *Aperture* picked this for you"** note in the detail page's insights panel (and, where the AI Picks libraries are still written, in their descriptions on your media server). Your account may have this locked by an admin, in which case the card shows the effective setting with a **Reset to Default** option instead of the toggle. Changes apply when recommendations are next regenerated — turning it on doesn't backfill old runs.

## Similarity Graph

Two switches for the related-content graphs on detail pages (see [Related-Content Graphs](../similarity-graphs.md)):

| Setting | Effect | Use it when |
|---------|--------|-------------|
| **Hide Watched Content** | Related titles you've seen don't appear | You browse related items to find something *new* |
| **Full Franchise Mode** | Keeps whole collections together rather than trimming to a representative few | You'd rather see every entry of a franchise than its best-known face |

## Poster Display

**Show rating badge on library posters** — turn it off if your artwork already carries a rating (many custom covers do); Aperture-sourced covers from Discover/TMDb always show their corner badge regardless. A **Reset to server default** option appears once you've chosen.

## Trakt Integration

Connect, sync, or disconnect your Trakt account. This card only appears when your admin has configured Trakt on the server — see [Trakt Integration](../trakt-integration.md) for the full flow.

## Email & Notifications

A toggle for receiving email notifications about your recommendations, and your email address. This card appears only when your **admin grants email notifications** for your account. Aperture doesn't send any email yet; this only records your address and your choice for when it does. The address must be one plain email address.

The email address starts synced from your media server account; setting a custom one **locks it** against future overwrites from Emby/Jellyfin (the helper text tells you which state you're in). Changes save as you leave the field.

---

## Not Here Anymore

- **Dislike behavior** lives in the [AI Algorithm](ai-algorithm.md) tab
- **Browse view modes, sort orders, and filter presets** are managed on the [Browse](../browse.md) page itself — they persist per account automatically

---

**Next:** [AI Algorithm](ai-algorithm.md)
