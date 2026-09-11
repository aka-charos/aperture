# Logs

How much detail the server writes — **not** a log viewer. This page controls access-log verbosity; there is no in-app log file browser (job run logs live per-job on [Jobs](jobs-overview.md)).

## Where It Lives

Admin console → **Operations** → **Logs** (`/admin/ops/logs`).

## The Two Switches

**Quiet poll-route logs** — suppresses request/response access logs for high-frequency UI poll endpoints (e.g. `/api/jobs/active`, which the jobs console polls continuously). Errors on those routes are still logged. Default comes from the `QUIET_POLL_LOGS` env var (`true`, or a comma-separated route list).

**Mask server address in logs** — replaces the public hostname with `[masked-host]` and client IPs with `[masked-ip]` in access logs; method, path, status, and timing are untouched. Default from `MASK_LOG_URLS`. Useful when logs leave the machine (support tickets, aggregators).

Both apply **immediately** — no restart; each key saves independently, so an old client can't blank the other.

## Where Logs Actually Are

- **Job runs** — per-run logs in each job's history dialog ([Jobs](jobs-overview.md))
- **API access logs** — the API container's stdout (`docker logs` / your collector)
- **Integration failures** — surfaced in the [API errors](api-errors.md) panel rather than only in logs

For deeper verbosity/privacy posture (trust proxies, cookie security, setup exposure), see [Deployment & security](deployment.md).

---

**Related:** [Deployment & security](deployment.md) · [Jobs overview](jobs-overview.md) · [API errors](api-errors.md)
