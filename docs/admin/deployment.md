# Deployment & Security

How this instance is reached, and whether that's set up correctly. Mostly a **read-only posture panel** with computed findings — plus one live control: trusted proxies.

## Where It Lives

Admin console → **Access** → **Deployment & security** (`/admin/access/deployment`).

## The Posture Panel

Status rows with ok/warning chips:

| Row | What it tells you |
|-----|-------------------|
| **Reached via** | Direct connection, or a proxy/tunnel (named by observed addresses) |
| **Client IPs** | Real visitor IPs, or "all visitors look identical" (nobody trusted) |
| **Trusted proxies** | Off / comma list / "all (unsafe)" |
| **Session cookie** | Secure / Not Secure (warned in production) |
| **First-run setup** | Local-network only / reachable from anywhere (`SETUP_ALLOW_REMOTE`) |
| **API docs** | Public exposure flagged in production (`API_DOCS=admin\|off`) |
| **Listening on** | Bind host — flagged when bound to all interfaces in proxy mode |

## Findings

Server-computed problems, each with a **monospace fix line**: proxy headers ignored, all traffic one address, proxy mode with nothing trusted, `TRUST_PROXY=true` (forged IPs, per-attacker rate-limit resets, setup looks local), bound to all interfaces, insecure cookie, passwordless permitted, public API docs, remote setup allowed, CSP report-only. "No problems detected" when clean.

## Trusted Proxies (the one live setting)

A comma-separated list of proxy addresses/CIDRs (`127.0.0.1, 172.18.0.0/16`). When untrusted forwarders are observed on the wire, the page offers a one-click **"Trust {addresses}"**; presets cover **Same machine** / **Docker network** / **Nothing in front**. Applies to the **next request** — no restart. If the `TRUST_PROXY` env var manages the list, the editor refuses and says so. Everything else on the panel needs an env change + restart.

## Why It Matters

Behind an unconfigured proxy, every visitor shares one address — which breaks per-user rate limiting (including login lockout fairness) and makes the setup wizard think a remote visitor is local. Fix trust first; the panel re-grades itself.

---

**Related:** [Logs](logs.md) · [Media server](media-server.md) · [Setup wizard](setup-wizard.md)
