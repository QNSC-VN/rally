/**
 * WHICH tier each auth route carries, and why the ordering between them is not arbitrary.
 *
 * Nothing asserted this, and the absence is what let the assignment invert: `AUTH_LOGIN`
 * ("brute-force prevention on credential submission") sat on the two SSO-initiation routes, which
 * submit no credential at all, while `POST /v1/bff/dev-login` — the one route that takes an address
 * and mints a session from it — carried no limit whatsoever. The protection was where it could not
 * help and missing where it could, and every test passed.
 *
 * It surfaced as a usability fault rather than a security one: 5 per 15 minutes per IP meant a person
 * who fumbled a passkey, abandoned the Microsoft page, or switched accounts a few times was refused
 * permission to even ATTEMPT another sign-in. Which is the tell — a limit that stops real users and
 * no attacker is on the wrong route.
 *
 * A SOURCE-READING test, deliberately. The fault is a decorator naming the wrong tier: that is
 * visible in the file and invisible to any test that exercises the handler, because the guard is
 * satisfied either way. Same shape as `route-policy.ratchet.spec.ts`, and the same reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_TIERS } from './rate-limit.constants';

const BFF_CONTROLLER = join(
  __dirname,
  '../../../modules/identity/src/interface/http/bff/bff.controller.ts',
);

/** The tier decorating `@Post('<route>')`, read from the source. */
function tierFor(source: string, route: string): string | null {
  const at = source.indexOf(`@Post('${route}')`);
  if (at === -1) throw new Error(`No @Post('${route}') in the BFF controller`);
  // Decorators sit between this @Post and the next one; a tier further down belongs to another route.
  const nextPost = source.indexOf('@Post(', at + 1);
  const block = source.slice(at, nextPost === -1 ? undefined : nextPost);
  return /@RateLimit\('([A-Z_]+)'\)/.exec(block)?.[1] ?? null;
}

describe('auth rate-limit tiering', () => {
  const source = readFileSync(BFF_CONTROLLER, 'utf8');

  it('puts the brute-force tier on the route that submits a CREDENTIAL', () => {
    // dev-login accepts an email and mints a session. It is 404 in production — but `NODE_ENV`
    // defaults to `development` in env.schema.ts, so a lost env var fails OPEN to a passwordless
    // login, and this limit is the last line for exactly that case.
    expect(tierFor(source, 'dev-login')).toBe('AUTH_LOGIN');
  });

  it('does NOT put it on the SSO-initiation routes, which submit nothing secret', () => {
    // Both mint a `state` cookie and return an authorize URL; the credential goes to the IdP. There is
    // nothing here to guess, so brute-force strength buys no security and costs real sign-ins.
    expect(tierFor(source, 'login/sso')).toBe('AUTH_SSO_START');
    expect(tierFor(source, 'login/start')).toBe('AUTH_IDP_LOOKUP');
    expect(tierFor(source, 'login/sso')).not.toBe('AUTH_LOGIN');
    expect(tierFor(source, 'login/start')).not.toBe('AUTH_LOGIN');
  });

  it('every auth route carries SOME tier — an undecorated one falls to DEFAULT silently', () => {
    // DEFAULT is 100/min, which is not a refusal anyone would notice. `dev-login` reaching production
    // undecorated is the precise history this guards.
    for (const route of ['login/sso', 'login/start', 'dev-login']) {
      expect(tierFor(source, route), `${route} has no @RateLimit`).not.toBeNull();
    }
  });

  /**
   * The ordering encodes the reasoning, so a later "let's loosen it" cannot quietly cross a boundary
   * it did not mean to. Strictest where a secret crosses; loosest where nothing does; the email
   * lookup in between because it discloses whether an address routes — a soft enumeration oracle.
   */
  it('orders the tiers by what crosses the boundary, not by route name', () => {
    const credential = RATE_LIMIT_TIERS.AUTH_LOGIN.limit;
    const lookup = RATE_LIMIT_TIERS.AUTH_IDP_LOOKUP.limit;
    const start = RATE_LIMIT_TIERS.AUTH_SSO_START.limit;

    expect(credential).toBeLessThan(lookup);
    expect(lookup).toBeLessThan(start);
    // All three share the 15-minute window: a shorter one on any of them would allow
    // burst-then-wait circumvention, which is why the credential tier chose it in the first place.
    expect(RATE_LIMIT_TIERS.AUTH_SSO_START.windowSeconds).toBe(15 * 60);
    expect(RATE_LIMIT_TIERS.AUTH_IDP_LOOKUP.windowSeconds).toBe(15 * 60);
  });

  it('keys the auth tiers on the caller, not on a session cookie', () => {
    // `keyBy: 'refreshToken'` would bucket per existing session — meaningless before one exists, and
    // it would hand an attacker a fresh quota per request. Absent means the guard falls back to
    // `uid:` or `ip:`, and these routes are @Public, so always `ip:`.
    expect('keyBy' in RATE_LIMIT_TIERS.AUTH_SSO_START).toBe(false);
    expect('keyBy' in RATE_LIMIT_TIERS.AUTH_IDP_LOOKUP).toBe(false);
    expect('keyBy' in RATE_LIMIT_TIERS.AUTH_LOGIN).toBe(false);
  });
});
