/**
 * The SSO facts a JIT-provisioning e2e principal has to match, read from the SAME environment the
 * seed bootstrapped from.
 *
 * `seedTenantBootstrap` builds the SSO connection out of `ENTRA_TENANT_ID` and its JIT allow-list out
 * of `SSO_ALLOWED_EMAIL_DOMAINS`, so a spec that mints an `EntraClaims` has to derive both from the
 * same place or it is asserting against one particular machine's configuration.
 *
 * Nine files hard-coded `externalTenantId: 'dev-tenant'` instead. That value is CI's, so the suite
 * was green there and failed on every developer machine whose `.env` says otherwise — this repo's
 * says `local-dev-tenant` — with `DomainException: No workspace is configured for your organization`
 * out of `ssoLogin`, thrown from the spec's own setup helper. It reads exactly like a product defect
 * in the route under test, and it is not one: 32 tests across 8 files failed that way, none of them
 * about SSO.
 *
 * `sso-rbac.e2e.spec.ts` and `authz-revocation.e2e.spec.ts` had already been fixed this way
 * individually; this is that same fix with one home, so the next spec to mint a principal inherits it
 * rather than copying the literal again.
 *
 * The fallbacks are CI's values, so nothing changes where the variables are already set.
 */

/** The tenant `seedTenantBootstrap` wrote the SSO connection for. */
export const SSO_TENANT_ID = process.env['ENTRA_TENANT_ID'] ?? 'dev-tenant';

/**
 * The first allowed email domain, which is what makes a JIT login provision instead of being
 * refused. Derived from the connection's own allow-list rather than from the seeded admin's address:
 * the admin address would happen to pass while asserting something else.
 */
export const SSO_EMAIL_DOMAIN = (process.env['SSO_ALLOWED_EMAIL_DOMAINS'] ?? 'qnsc.vn')
  .split(',')[0]
  .trim();

/** A unique address inside that domain — `label` only exists to make a failure readable. */
export function ssoEmail(label: string): string {
  return `${label}@${SSO_EMAIL_DOMAIN}`;
}
