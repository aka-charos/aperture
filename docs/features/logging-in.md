# Logging In

Aperture uses your existing Emby or Jellyfin credentials — no separate account needed.

![Login Screen](../images/features/login.png)

## How to Log In

1. Open Aperture in your browser
2. Enter your **media server username**
3. Enter your **media server password**
4. Click **Sign In**

Aperture authenticates directly against your Emby or Jellyfin server. The app name and branding may differ on your server's deployment, but the flow is the same.

## Passwordless Login

If your admin has enabled passwordless login (for media servers that don't require passwords):

- The password field shows **(optional)**
- You can log in with just your username

## First-Time Login

Your user account is **imported automatically** the first time you sign in — there's no account creation step. Watch-history sync and your first recommendation run are admin-side jobs, so if your dashboard looks empty at first, they may still need to run (the empty states tell you).

---

## Troubleshooting

| Message | What it means |
|---------|---------------|
| **"Invalid username or password"** | The credentials don't work — try them in Emby/Jellyfin directly |
| **"Too many failed attempts for this account."** | Brute-force lockout; wait a bit and try again |
| **"This account has been disabled."** | An admin has disabled your Aperture account, even though your media-server credentials are valid — contact your admin |
| **"Could not reach the media server."** | Aperture can't see Emby/Jellyfin right now; try again shortly |

Note that a wrong username and a wrong password say the same thing — deliberately, so usernames can't be probed.

## Session Duration

You stay signed in until:

- **30 days** pass since you logged in (absolute expiry), or
- **7 days** pass without using Aperture (idle expiry) — whichever comes first

Sign out any time from the avatar menu.

---

**Next:** [Dashboard](dashboard.md)
