import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService } from '@qnsc-vn/identity';
import { AppConfigService } from '@platform';
import type { JwtPayload } from '@platform';
import { EntraOidcClient } from './entra-oidc.client';
import { BffSessionStore } from './bff-session.store';
import type { BffSession } from './bff.types';
import { decodeAccessTokenClaims, isSafeReturnTo } from './bff.util';

/** Refresh the access token this many ms *before* it actually expires. */
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;

/** Result of starting a login: where to send the browser + the CSRF `state`. */
export interface BffLoginStart {
  authorizeUrl: string;
  state: string;
}

/** Result of completing a login: the new session id + validated landing path. */
export interface BffLoginComplete {
  sid: string;
  returnTo: string;
}

/**
 * Orchestrates rally's Backend-for-Frontend authentication: it runs the Entra
 * Authorization-Code + PKCE flow server-side, mints an opaque server-side
 * session on success, and resolves/refreshes that session on each request. The
 * browser only ever holds the session id; all real tokens stay in Valkey.
 *
 * This is the one product-coupled piece (it calls rally's {@link AuthService}
 * and reads rally config); the client, store, and guard around it are generic.
 */
@Injectable()
export class BffService {
  private readonly logger = new Logger(BffService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly oidc: EntraOidcClient,
    private readonly store: BffSessionStore,
    private readonly authService: AuthService,
  ) {}

  /** Whether BFF auth mode is active. When false every /bff/* route 404s. */
  get enabled(): boolean {
    return this.config.get('AUTH_MODE') === 'bff';
  }

  /**
   * Begin login: generate PKCE + `state`, persist the pending auth request, and
   * return the Entra authorize URL to redirect the browser to.
   */
  async beginLogin(rawReturnTo: string | undefined): Promise<BffLoginStart> {
    const state = randomUUID();
    const { verifier, challenge } = EntraOidcClient.generatePkce();
    const returnTo = isSafeReturnTo(rawReturnTo)
      ? rawReturnTo
      : this.config.get('BFF_POST_LOGIN_REDIRECT');

    await this.store.saveAuthRequest({
      state,
      codeVerifier: verifier,
      returnTo,
      createdAt: Date.now(),
    });

    const authorizeUrl = this.oidc.buildAuthorizeUrl({ state, codeChallenge: challenge });
    return { authorizeUrl, state };
  }

  /**
   * Complete login from the OIDC callback: verify `state` against both the
   * browser cookie and the single-use stored request, exchange the code for an
   * `id_token`, run rally's SSO login, and persist a fresh server-side session.
   */
  async completeLogin(params: {
    code: string;
    state: string;
    cookieState: string | undefined;
    ip: string;
  }): Promise<BffLoginComplete> {
    // Double-submit state check: the value echoed by Entra must match both the
    // browser-bound cookie and the server-side record. This defeats login CSRF.
    if (!params.cookieState || params.cookieState !== params.state) {
      throw new Error('BFF callback state does not match the browser cookie');
    }
    const authRequest = await this.store.takeAuthRequest(params.state);
    if (!authRequest) {
      throw new Error('BFF auth request not found or already used');
    }

    const { idToken } = await this.oidc.exchangeCode({
      code: params.code,
      codeVerifier: authRequest.codeVerifier,
    });
    const loginResult = await this.authService.ssoLogin(idToken, params.ip);

    const sid = randomUUID();
    await this.store.saveSession(sid, this.toSession(loginResult), this.sessionTtlSeconds);
    return { sid, returnTo: authRequest.returnTo };
  }

  /**
   * Resolve the principal for a session id, transparently rotating the access
   * token when it is at/near expiry. Returns `null` when the session is missing,
   * or when a refresh fails (in which case the dead session is dropped).
   */
  async resolve(sid: string, ip: string): Promise<JwtPayload | null> {
    const session = await this.store.getSession(sid);
    if (!session) return null;

    if (Date.now() < session.accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS) {
      return session.claims;
    }

    try {
      const refreshed = await this.authService.refresh(session.refreshToken, session.csrfToken, ip);
      const next = this.toSession(refreshed);
      await this.store.saveSession(sid, next, this.sessionTtlSeconds);
      return next.claims;
    } catch (err) {
      this.logger.warn({ err }, 'BFF session refresh failed; dropping session');
      await this.store.deleteSession(sid);
      return null;
    }
  }

  /** Revoke the underlying auth session and delete the server-side BFF session. */
  async logout(sid: string, principal: JwtPayload): Promise<void> {
    await Promise.allSettled([this.authService.logout(principal), this.store.deleteSession(sid)]);
  }

  /** Session lifetime in seconds — also used as the session cookie's `Max-Age`. */
  get sessionTtlSeconds(): number {
    return this.config.get('BFF_SESSION_TTL_SECONDS');
  }

  /** Build a session record from an SSO/refresh result (both carry the tokens). */
  private toSession(result: {
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
  }): BffSession {
    const claims = decodeAccessTokenClaims(result.accessToken);
    return {
      claims,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken: result.csrfToken,
      accessTokenExpiresAt: (claims.exp ?? 0) * 1000,
      createdAt: Date.now(),
    };
  }
}
