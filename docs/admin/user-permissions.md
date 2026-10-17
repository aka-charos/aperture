# User Permissions

What each user may do, where it is granted, what decides which titles they see, and what users control themselves.

## Where Permissions Are Granted

Most switches sit on each row of the [Users page](user-management.md) (`/admin/access/users`); the rest are on the **user detail page → Settings** tab (`/admin/access/users/:id`), which also keeps a **Permission history** of every change.

| Permission | Where | Grants |
|------------|-------|--------|
| **Aperture access** | Users list | Signing in at all. Off ends sessions and stops all background work for the account while keeping every other switch as it is; see [Access](user-management.md#access). |
| **Recommendations** | Users list | Personal recommendations, Emby home rows and (legacy) generated libraries. One switch for both media types: which of movies and series the account gets follows from its [library scope](#which-titles-a-user-sees). |
| **Discover** | Users list, detail page | The [Discover](../features/discovery.md) page of suggestions for titles not in the library |
| **Request** | Users list, detail page | Request buttons that send titles to Seerr. Needs Discover: switching Discover off switches this off too, and it cannot be switched on without it. |
| **Collections** | Users list, detail page | Creating [collections](../features/collections.md), which are written to the media server as Box Sets everyone can see |
| **Assistant** | Users list | The AI assistant. Every message costs model calls. On for everyone by default. |
| **Email** | Users list, detail page | Shows the Email & Notifications card in their settings, where they can enter an address and opt in. No email is sent yet. |
| **AI Override** | Users list, detail page | Lets the user choose their own AI-explanation preference; only meaningful while **Allow Per-User Overrides** is on (see [AI explanations](ai-explanations.md)) |
| **Watch history management** | Detail page | Marking titles watched or unwatched from their watch history and detail pages |
| **Seerr mapping** | Detail page | Overrides which Seerr account their requests and issues are made as. Leave empty to match automatically by email or username. |

**Admins** always have Collections, the Assistant and watch history management. **Discover is the exception**: an admin with Discover switched off is refused there like anyone else.

Every change, including one that followed automatically from another switch (Request going off with Discover), is recorded in the account's **Permission history** with who made it.

## Which Titles a User Sees

What a user is shown is their **library scope**: the libraries the media server lets their account open, among the libraries enabled on the [Libraries](libraries.md) page, plus their **parental rating** limit from the media server. Aperture reads the account's library access at each user sync and at sign-in, so a change made in Emby or Jellyfin takes effect within 30 minutes.

The scope applies to recommendations, Browse, search, similar titles, the Explore graph, the assistant, detail pages, Top Picks and home rows. A title outside it is treated as not existing. It also decides recommendation kinds: an account that can open no series library gets no series recommendations, whatever its Recommendations switch says. A user's own records (watch history, ratings, stats) are never filtered.

Until an account's library access has been read for the first time, every enabled library counts.

## What Users Control Themselves (No Admin Gate)

In their own settings:

- **Recommendations**: their taste (interests, genre and franchise weights, which libraries shape it), whether watched titles may come back, how low-rated titles are treated, the explanation (when you allow the override), and, under Advanced, their own scoring weights (your defaults apply until they switch it on) ([Recommendations settings](../features/user-settings/recommendations.md))
- **Display**: poster rating badges and the similarity graph options ([Display](../features/user-settings/display.md)); their languages are set from the flag in the top bar
- **Account**: their email address and opt-in (when granted), Trakt, and their AI library names (legacy output only) ([Account](../features/user-settings/account.md))
- **Emby home screen** (Emby accounts): which [home rows](home-rows.md) they get and where

## API Keys

An API key acts as the account that made it, but only with the rights its scopes allow: a **read** key cannot change anything, and only an **admin** scope on an admin's key carries admin rights. See [API keys](api-keys.md).

## The One Global Gate That Interacts

**Recommendations → Explanations → Allow Per-User Overrides** is the global switch that makes the per-user AI-explanation permission meaningful. The effective value chains global default → your grant → their choice (see [AI explanations](ai-explanations.md)).

---

**Related:** [User management](user-management.md) · [AI explanations](ai-explanations.md) · [Libraries](libraries.md) · [API keys](api-keys.md)
