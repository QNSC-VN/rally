# Alert: http-5xx-rate

Ratio of `http_server_errors_total` to `http_server_requests_total` over 5 minutes has
crossed the environment's threshold (2% prod / 5% develop) for 5 minutes straight.

## What this means

The API is returning 5xx to a meaningful share of real traffic — not a single blip.

## First checks

1. Open the Overview dashboard's "HTTP status code distribution" and "Recent errors"
   panels for this env — is it one route or everything?
2. Check the "Recent errors" / Logs Explorer panel for the actual stack trace. Most
   5xx spikes have one dominant error message.
3. Check the Deploys annotation line on the same dashboard — did this start right after
   a deploy? If so, this is very likely a bad release, not organic load.
4. Check "DB pool: in use vs waiting" — a saturated pool throws `PermissionDeniedException`
   / connection errors that surface as 5xx.
5. Check RDS CPU/connections (CloudWatch, per-env dashboard) — a slow query can cascade
   into request timeouts across the whole API.

## Likely causes, roughly in order

- Bad deploy (see Deploys annotation)
- DB pool exhaustion / a slow query holding connections
- A downstream dependency (SES, Cloudflare, GitHub App webhook) timing out
- Cache (Valkey) unreachable — auth denylist/rate-limiter fail open, but other
  Valkey-dependent paths can throw instead

## Escalate if

The error rate keeps climbing after 15 minutes with no obvious cause, or a rollback
of the most recent deploy does not clear it.
