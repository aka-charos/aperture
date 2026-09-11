# Media Server Configuration

Configure the connection between Aperture and your Emby or Jellyfin server. One media server at a time.

![Admin Settings - Media Server](../images/admin/admin-settings-setup-media.png)

## Accessing Settings

Admin console → **Library** → **Media server** (`/admin/library/server`).

## Configuration

| Setting | Description |
|---------|-------------|
| **Server Type** | Emby or Jellyfin |
| **Server URL** | Base URL as **Aperture** reaches it — e.g. `http://192.168.1.10:8096`. In Docker, that's often the container/LAN address, not your public one |
| **API Key** | From your server's admin panel (Emby: Dashboard → Advanced → API Keys; Jellyfin: Dashboard → API Keys) — masked once saved |
| **Public URL (optional)** | The address users' **browsers** should open for "Open in Emby/Jellyfin" buttons, when it differs from the server URL (reverse proxy, split DNS, container networking) |
| **Server Display Name (optional)** | Overrides the server's own name everywhere in the UI |

**Test** verifies the key and shows the resolved **server name** with a "Connected" state. (There is deliberately no version display — the connection test reports what the app uses.)

## Security Settings

**Allow passwordless login** — for media servers that permit passwordless accounts. When on, the login page's password field becomes optional and anyone who can reach Aperture can start a session for any known username; the toggle carries an exposure warning accordingly. Off by default.

## Environment Fallback

With nothing stored yet, Aperture falls back to `MEDIA_SERVER_TYPE` / `MEDIA_SERVER_URL` / `MEDIA_SERVER_API_KEY` environment variables — useful for infrastructure-as-code deployments. Values saved on this page always win.

## Troubleshooting

- **Test fails, but Emby works in a browser** — the URL is the *browser* address; give Aperture the address it can reach (container networks can't use `localhost`)
- **Connected, but libraries empty** — that's the API key's user scope or the [Libraries](libraries.md) toggles, not this page
- **"Open in Jellyfin" opens the wrong address** — set **Public URL** to what browsers should use

---

**Related:** [Libraries](libraries.md) · [File locations](file-locations.md) · [Setup wizard](setup-wizard.md)
