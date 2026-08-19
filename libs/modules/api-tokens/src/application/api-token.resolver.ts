import { Injectable } from '@nestjs/common';

import type { ApiTokenPrincipal, ApiTokenResolver } from '@platform';

import { ApiTokensService } from './api-tokens.service';

/**
 * Binds {@link ApiTokensService} to the platform guard's optional {@link ApiTokenResolver} seam.
 *
 * Thin by design: the guard owns the HTTP contract (what a failure means, which denylist applies), the
 * service owns the credential rules, and this only translates a verified token into the principal shape
 * every downstream consumer already understands.
 */
@Injectable()
export class ApiTokenPrincipalResolver implements ApiTokenResolver {
  /**
   * Always on where this module is imported. There is no flag because there is nothing to stage: a
   * product without machine credentials leaves the module out and the guard's path disappears with it.
   */
  readonly enabled = true;

  constructor(private readonly tokens: ApiTokensService) {}

  async resolve(rawToken: string): Promise<ApiTokenPrincipal | null> {
    const verified = await this.tokens.verify(rawToken);
    if (!verified) return null;

    return {
      sub: verified.userId,
      workspaceId: verified.workspaceId,
      /** rally's authorization scope IS the workspace; the core treats it as opaque. */
      contextId: verified.workspaceId,
      /**
       * The token's own id, in the field a JWT would carry its `jti`, and again as `sessionId`.
       * Downstream code that logs or audits by session id therefore keeps working unchanged, and an
       * audit row names the credential rather than a session that never existed — a token is not a
       * login, so there is no session to point at.
       */
      sessionId: verified.id,
      jti: verified.id,
      /**
       * The row's real instants, not placeholders: `iat` is when the token was minted and `exp` when it
       * expires, so anything downstream that reads either sees the truth. Expiry is still enforced by
       * the verify query — this claim is descriptive, and a claim nobody enforces must at least not lie.
       */
      iat: Math.floor(verified.createdAt.getTime() / 1000),
      exp: Math.floor(verified.expiresAt.getTime() / 1000),
      iss: API_TOKEN_ISSUER,
      aud: API_TOKEN_ISSUER,
      /**
       * Empty, always. `PolicyGuard` resolves permissions from the database per request; this array is
       * inert in this codebase by design (CLAUDE.md), and populating it here would look like the
       * mint-time snapshot that was deliberately removed.
       */
      permissions: [],
      claims: { permissions: [] },
      /**
       * Not 'password' and not 'sso' in any real sense — the union has no third member, and adding one
       * would ripple through every product on the shared package. 'password' is the honest choice of the
       * two: like a password, this credential is presented directly by its holder with no identity
       * provider involved. What actually distinguishes this principal is `apiTokenId`, which is set.
       */
      authMethod: 'password',
      apiTokenId: verified.id,
      scopes: verified.scopes ?? undefined,
    };
  }
}

/**
 * Issuer/audience recorded on a token principal.
 *
 * Not the JWT issuer: nothing signs or verifies these claims, and reusing `JWT_ISSUER` would make a
 * token principal indistinguishable from a real access token in a log. A distinct literal makes the
 * authentication path visible wherever the principal is recorded.
 */
const API_TOKEN_ISSUER = 'rally:api-token';
