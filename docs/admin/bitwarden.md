# Bitwarden Secrets Manager

Optional. Keep API keys in a [Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/) project and have Aperture read them from there, instead of saving them in Aperture's database.

A key read from Bitwarden is held in memory only. It is not written to the database, so it is not in backups either. Rotating a key means changing it in Bitwarden; Aperture picks the new value up within five minutes, or at once with **Read again**.

## Where It Lives

Admin console → **Integrations** → **Bitwarden secrets** (`/admin/integrations/bitwarden`). The chip shows **Connected**, **Needs attention** or **Not set up**.

## What Can Be Linked

| Credential | Normally entered on |
|------------|---------------------|
| Media server API key | [Media server](media-server.md) |
| TMDb API key | [TMDB](tmdb.md) |
| OMDb API key | [OMDb](omdb.md) |
| MDBList API key | [MDBList](mdblist.md) |
| Seerr API key | [Seerr](seerr.md) |
| Trakt client secret | [Trakt](trakt.md) |
| LLDAP admin password | [LLDAP](lldap.md) |

Keys for AI providers, outgoing email, Tavily, fastCRW, the decision model, synopsis translation and n8n cannot be linked yet. They stay on their own pages.

## Setup

### In Bitwarden

1. Create a **project** for Aperture and put only Aperture's secrets in it. Any secret in the project can be linked to any credential above, so do not share the project with other applications.
2. Add one secret per key. The name is yours to choose (for example `TMDB_API_KEY`); each name must be used once in the project.
3. Create a **machine account**, give it **read** access to that project, and create an **access token** for it.
4. Copy the project's id (a UUID, shown in the project's address).

### On the Aperture container

Set these environment variables and restart the container:

| Variable | Value |
|----------|-------|
| `BWS_ACCESS_TOKEN` | The machine account's access token |
| `BWS_PROJECT_ID` | The project's id (UUID) |
| `BWS_SERVER_URL` | Only outside Bitwarden's US cloud: `https://vault.bitwarden.eu` for the EU cloud, or your own server's address |

These are read from the environment only and cannot be changed in the console. A token saved in the database would put the key to every secret back where the keys used to be.

The image includes the Bitwarden CLI (`bws`), which does the reading. Outside Docker, install `bws` and put it on the `PATH`, or set `BWS_PATH` to it.

## Linking a Credential

On the card, pick a secret next to a credential and press **Link**. From then on that integration uses the secret's value.

- Linking **replaces** the key saved for that integration.
- **Unlink** leaves the integration without a key until you enter one on its own page. Aperture never copies a secret's value into its database.
- Entering a key on the integration's own page replaces the link.
- A link is refused unless the secret can be read at that moment.

## When Bitwarden Cannot Be Read

- If a read fails after an earlier one succeeded, the values from the last successful read stay in use and the card says so. Aperture asks again every 30 seconds.
- If Aperture starts while Bitwarden is unreachable, linked integrations have no key until a read succeeds. They behave as if not configured; the card shows which ones and why.
- A linked secret that was deleted, emptied or renamed leaves its integration without a key. The card names the secret it is looking for.

The card shows the Bitwarden CLI's own error message. Secret values and the access token are never shown or logged.

## What It Does Not Do

- The Aperture process still holds linked keys in memory while it runs.
- The access token on the host is now the secret to protect: anyone holding it can read the project.
- An admin can link any secret in the project to any credential, and that integration sends its key to its saved server address. This is why the project should hold only Aperture's secrets.
- It needs Secrets Manager on the Bitwarden server you point it at. Check that a self-hosted or Bitwarden-compatible server offers it before relying on this.

**Related:** [Integrations overview](integrations-overview.md) · [API keys](api-keys.md) · [Backup and restore](backup-restore.md) · [Deployment](deployment.md)
