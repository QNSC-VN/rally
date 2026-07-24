# SCM Connections — GitHub App & Backfill (runbook)

Rally links GitHub pull requests and commits to work items when their title,
branch, or commit message references a work-item key (e.g. `US-42`). This runbook
covers the **Phase 2** setup: a dedicated GitHub App that (a) auto-delivers
webhook events for every installed repo and (b) lets Rally backfill a repo's
**existing** PRs/commits over the REST API when you map it.

Phase 1 (inbound webhook → HMAC verify → `scm.webhook_inbox` → worker relay →
linker) still works on its own; the App just replaces per-repo webhook setup and
adds history.

---

## 1. Register the "Rally SCM" GitHub App (org admin)

On github.com → your org → **Settings ▸ Developer settings ▸ GitHub Apps ▸ New GitHub App**:

- **Homepage URL**: your Rally URL.
- **Webhook ▸ Active**: on.
  - **Webhook URL**: `https://<rally-host>/v1/scm/webhook/github`
  - **Webhook secret**: a strong random string — this becomes `GITHUB_WEBHOOK_SECRET`.
- **Permissions ▸ Repository**:
  - Pull requests: **Read-only**
  - Contents: **Read-only**
  - Metadata: **Read-only** (mandatory)
- **Subscribe to events**: **Pull request**, **Push**.
- **Where can this app be installed**: Only on this account.

Create it, then:
1. Note the **App ID**.
2. **Generate a private key** — downloads a `.pem` (PKCS#1 or PKCS#8; the auth
   service accepts both).
3. **Install** the App on the org and choose the repos (or all repos).

## 2. Provide credentials to Rally

Config keys (`libs/platform/src/config/env.schema.ts`):

| Key | Value | Notes |
|-----|-------|-------|
| `GITHUB_APP_ID` | the App ID | required for App auth |
| `GITHUB_WEBHOOK_SECRET` | the webhook secret above | already used by the Phase-1 receiver |
| `GITHUB_API_BASE_URL` | `https://api.github.com` | default; only change for GHE |
| `GITHUB_APP_PRIVATE_KEY` | the PEM contents | **local/dev** — literal `\n` are normalised |
| `GITHUB_APP_PRIVATE_KEY_SECRET_REF` | a Secrets Manager ref | **prod** — resolved via `SECRET_RESOLVER`; takes over from the inline key |

In production put the private key in Secrets Manager and set
`GITHUB_APP_PRIVATE_KEY_SECRET_REF` (e.g. `rally/<env>/scm/github-app-private-key`);
leave `GITHUB_APP_PRIVATE_KEY` unset. Everything is optional — if unset, backfill
logs "GitHub App not configured — skipping" and webhooks still function.

## 3. Map a repository (Settings ▸ Integrations)

Add a repo as `owner/name` and pick the project(s) whose work-item keys it may
reference. On save, Rally **auto-enqueues a backfill job**. Use **Sync now** on a
row to re-enqueue at any time.

## How it works

- **Auth** (`github-app-auth.service.ts`): mints an App JWT (RS256, `iss`=App ID,
  ≤10 min) → resolves the repo's installation id (`GET /repos/{o}/{r}/installation`)
  and caches it on `scm.repositories.installation_id` → exchanges it for a
  short-lived installation token (`POST /app/installations/{id}/access_tokens`),
  cached in memory until ~1 min before expiry.
- **Backfill** (`scm-backfill.service.ts`): lists ~100 most-recent PRs (all states)
  and commits from the last ~90 days (page-capped so a huge repo can't run away or
  exhaust the 5k/hr rate limit), maps them to the **same** normalized shapes as the
  webhook parser, and links via the **same idempotent** upsert path. Commit file
  lists are fetched only for commits that actually reference a key.
- **Async job**: `POST /v1/scm/repositories/{id}/sync` (and repo creation) inserts a
  row into `scm.backfill_jobs`. The worker's `ScmBackfillRelayService` drains it on a
  30 s cron (`FOR UPDATE SKIP LOCKED`, exponential-backoff retry), one repo per pass,
  and records `{prs, commits, connections, changesets}` on the job row.

Idempotency: connections upsert on `(work_item_id, external_id)`, changesets on
`(work_item_id, revision)`. Re-running a backfill, retrying a failed job, or
overlapping with a live webhook never duplicates rows.

## Verify

1. Map a repo that has PRs/commits referencing existing work-item keys.
2. Within ~30 s, open one of those work items → **Connections** tab shows the
   linked PRs; **Changesets** shows the commits.
3. `select status, counts, last_error from scm.backfill_jobs order by requested_at desc limit 5;`
   — the latest row should be `done` with non-zero counts.
4. Open a new PR referencing a key → it appears via the App webhook (no per-repo
   webhook configured).

## Troubleshooting

- **Backfill job stuck `failed`** — check `last_error`. `401/403` → App not installed
  on that repo, or wrong key/App ID. `404` on `/installation` → the App isn't
  installed on the repo's owner.
- **No links despite a `done` job with `prs`/`commits` > 0** — the PRs/commits don't
  reference a mapped project's keys, or the repo→project mapping is wrong.
- **`SECRET_RESOLVER unavailable`** — `GITHUB_APP_PRIVATE_KEY_SECRET_REF` is set but
  the resolver isn't wired; set the inline `GITHUB_APP_PRIVATE_KEY` for local use.
