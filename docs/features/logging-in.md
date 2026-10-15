# Logging In

Aperture uses your existing Emby or Jellyfin credentials — no separate account needed.

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

There's no account to create: Aperture knows you from the media server. It still needs an administrator to **give your account access** before you can sign in. Until then, signing in says your access is turned off; your account is recorded on that first attempt, so the admin will find you on their Users page.

Watch-history sync and your first recommendation run are admin-side jobs, so if your dashboard looks empty at first, they may still need to run (the empty states tell you). Which libraries you see in Aperture follows what the media server lets your account open.

---

## Troubleshooting

| Message | What it means |
|---------|---------------|
| **"Invalid username or password"** | The credentials don't work — try them in Emby/Jellyfin directly |
| **"Too many failed attempts for this account."** | Brute-force lockout; wait a bit and try again |
| **"Your access is turned off. Contact your … administrator."** | Your media-server credentials are fine, but an admin has not given your account access to Aperture, or has turned it off. Your settings are kept; contact your admin |
| **"Could not reach the media server. Please try again shortly."** | Aperture can't see Emby/Jellyfin right now; try again shortly |

Note that a wrong username and a wrong password say the same thing — deliberately, so usernames can't be probed.

## Session Duration

You stay signed in until:

- **30 days** pass since you logged in (absolute expiry), or
- **7 days** pass without using Aperture (idle expiry) — whichever comes first

Sign out any time from the avatar menu. If an admin turns off your access, or your account is disabled on the media server, you are signed out at once.

---

**Next:** [Dashboard](dashboard.md)
