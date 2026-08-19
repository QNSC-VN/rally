# API tokens — connecting another application to Rally

Machine credentials for CI, scripts and agents. A user mints one, stores it, and sends it as a bearer
token; Rally treats it as that user, narrowed to whatever scopes the token was given.

Implemented in migration 0125. The design rationale is in the migration comment; the integration
pitfalls are in `CLAUDE.md`. This file is how to use it.

## Mint one

```bash
# Interactive session required — a token cannot mint a token (see "Refusals" below).
curl -sX POST https://rally.example/v1/me/api-tokens \
  -H "Authorization: Bearer $YOUR_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name": "agent-forge orchestrator", "expiresInDays": 90, "scopes": ["work_item:view"]}'
```

```json
{
  "id": "…",
  "name": "agent-forge orchestrator",
  "prefix": "rly_a1b2c3d4",
  "scopes": ["work_item:view"],
  "expiresAt": "2026-11-17T00:00:00.000Z",
  "token": "rly_XSm1…"
}
```

`token` appears **once**. It is stored only as a sha256 hash, so it cannot be shown again — a lost
token is revoked and replaced, not recovered. That is also real Rally's behaviour.

## Use it

```bash
curl https://rally.example/v1/work-items -H "Authorization: Bearer rly_XSm1…"
```

Same header as an access token. Rally distinguishes the two by the `rly_` prefix, so nothing else in a
client has to change.

## Scopes narrow, they never grant

Omit `scopes` and the token can do whatever its owner can. Supply them and the token is restricted to
the intersection: **your permissions ∩ the token's scopes**. Consequences worth designing around:

- A token can never exceed the person who minted it. Granting yourself more later does not widen an
  existing token; minting a new one does.
- Revoking a grant in Rally takes effect on the token's **next request** — permissions are resolved
  from the database every time, never read from the credential.
- An unknown permission code is rejected at mint, naming the code. It is not silently ignored, because
  at use time a typo and a missing permission are indistinguishable.

Codes come from `db/permissions.catalog.ts`. Wildcards work in scopes: `work_item:*` covers the
namespace.

## Lifetime and revocation

| | |
|---|---|
| Default lifetime | 90 days |
| Maximum | 365 days |
| Expiry | Mandatory — there is no never-expiring token |
| Revoke your own | `DELETE /v1/me/api-tokens/:id` |
| List your own | `GET /v1/me/api-tokens` (includes revoked ones — the list is the audit trail) |
| Administrator view | `GET /v1/api-tokens`, `DELETE /v1/api-tokens/:id` — needs `api_token:manage_all` |

A revoked or expired token answers **401**, not 403: the credential is invalid, which is a different
fact from being insufficiently permitted, and the two must not be confused while debugging an outage.

Removing or suspending a workspace member revokes their tokens automatically. Their automation stops
working immediately rather than at expiry.

## Refusals, and why

- **A token cannot mint, list or revoke tokens.** Otherwise a leaked token is not one credential but a
  credential factory: mint a fresh one and revoking the one you found changes nothing. GitHub applies
  the same rule to personal access tokens. Use an interactive session for token management.
- **A token cannot be recovered.** Only the hash is stored.
- **A token dies with its owner's membership.** It is that user's authority, not an independent one.

## Recommendations for a long-lived integration

1. **Use a dedicated service account**, not a person's login. In real Rally, API keys are deleted with
   the user — tie an unattended integration to an individual and it breaks the day their account
   changes. A service principal also makes the audit trail name the integration rather than a colleague.
2. **Scope it to what it does.** A reader gets `work_item:view`; nothing else needs to be possible.
3. **Store it like a password**: environment variable or secret manager, never in the repository, never
   in a log. Rally's own log redactor drops the field, but that only protects Rally's logs.
4. **Rotate on a schedule you choose**, not when it expires. `lastUsedAt` in the token list tells you
   whether an old token is still in use before you revoke it.
