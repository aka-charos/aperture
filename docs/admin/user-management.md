# User Management

Manage accounts, who can sign in, feature access, and per-user operations.

## Where It Lives

Admin console → **Access** → **Users** (`/admin/access/users`); click a row for the **user detail page** (`/admin/access/users/:id`).

## The User List

The list is drawn from the media server's own users. **Sync Users** imports new accounts and refreshes profile data (email, admin status); the `sync-users` job does the same every 30 minutes. An account not yet imported can be imported from its row.

Columns, left to right:

| Column | Meaning |
|--------|---------|
| **User** | Name, admin badge, email, last web sign-in and last streaming activity |
| **Emby account** (or Jellyfin) | The account's state on the media server: **Active**, or **Disabled** if it was disabled there. Read live; it is set in the media server's dashboard, not here. |
| **Aperture access** | Whether the account can sign in. See [Access](#access). |
| **Imported** | Whether Aperture has the account yet |
| **Recommendations** | Personal recommendations, home rows and (legacy) generated libraries. Whether that means movies, series or both follows from the libraries the media server lets the account see; hover the chip for which. |
| **Discover**, **Request**, **Collections**, **Assistant**, **Email**, **AI Override** | Feature permissions; see [User permissions](user-permissions.md) |
| **Actions** | **More user settings** opens the detail page; the **⌄ menu** holds the per-user operations below |

Sort by email, last sign-in or last streaming activity.

### Per-User Operations (the ⌄ menu)

- **Run Full Pipeline**: sync watch history, generate recommendations, then write the legacy library files (that last step is skipped while legacy library output is off)
- **Sync Watch History**, **Generate Recommendations**
- **Update STRM Files**: legacy output only, greyed while it is off
- **View the app as this user**: read-only; see [Viewing as a User](#viewing-as-a-user)
- **Connections…**: who this person shares their viewing with (see [Connections](#connections))

## Access

**Aperture access** is its own switch, separate from every feature switch:

- **Off** ends the account's sessions at once, stops its API keys, and stops all background work for it: recommendations, taste profiles, the Watcher Identity, discovery and personal home rows. Its legacy generated libraries are removed. Everything it is built from (watch history, ratings, settings) is kept, and the feature switches keep their values.
- **On** lets the account sign in again; its work resumes and its libraries are rebuilt at the next library sync.
- Feature switches can be set while access is off, so an account can be prepared before it is let in; they are shown dimmed until then.
- You cannot switch off your own access.

Separately, an account **disabled on the media server** cannot sign in either, whatever this switch says, and is skipped by every job. Signing in successfully through the media server clears that mark.

A user with no access who tries to sign in is told their access is turned off and to contact the server's administrator.

## User Detail Page

Tabs across the top:

- **Recommendations**: their current picks
- **Watch History**: a paginated, sortable view (recent / most played / title) of everything they have played, with play counts and favourite badges
- **Settings**: the permissions granted on this account (see [User permissions](user-permissions.md)), the **Seerr mapping** override, the AI-explanation override, and **Permission history**: every permission granted or revoked on the account, newest first, with who changed it, including changes that followed automatically from another switch

## Viewing as a User

**View the app as this user** shows the app exactly as that person sees it, with their recommendations, their libraries and their permissions. It is read-only: nothing is saved to their account, and a banner at the top ends it. It lasts an hour at most. Accounts without access, accounts not yet imported, and your own account cannot be viewed.

## Connections

**Connections…** pairs two accounts so each can see the other's name on titles they watched, read each other's watch history, see each other's recent watches on the dashboard, and recommend titles to each other on **Watch This**. Connections are made only by an admin and always go both ways. A connection is hidden while either account has no access, and returns with it. What a person sees of a connection's activity is still limited to the libraries they themselves can open.

## Accounts No Longer on the Media Server

The list is built from the media server's own users, so an account deleted there has no row in it. Such accounts are listed separately under it, as **No longer on Emby** (or Jellyfin), with when they were created, when they last signed in, and how much history they hold.

- The user sync (every 30 minutes) notices them: it signs them out, stops their API keys and pauses everything done for them (recommendations, home rows, generated libraries), and keeps everything stored. Until the next sync runs the row says **Pauses at the next user sync**.
- **Remove** deletes the account for good, with its watch history, ratings, recommendations, playlists and settings, after a confirmation. It asks the media server again first and refuses if the account is still there. Nothing changes on the media server itself.
- If the account comes back on the media server, or signs in, the next sync or the sign-in lifts the pause.

The sync refuses to treat anyone as gone when the media server lists nobody, or lists none of the accounts it knows (usually a changed server address), and says so in its job log.

## Emails

Emails come from the media-server sync, **manual entry** by the user, or the [LLDAP integration](lldap.md) (`sync-lldap-emails` job). The [Account drift](smtp.md#account-drift) card compares the three account lists.

---

**Related:** [User permissions](user-permissions.md) · [API keys](api-keys.md) · [Emby home rows](home-rows.md) · [Jobs overview](jobs-overview.md)
