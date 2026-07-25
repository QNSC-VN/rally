import { Inject, Injectable } from '@nestjs/common';
import { BffService } from '@qnsc-vn/identity';
import { type BffSessionResolver, type JwtPayload, toRallyPrincipal } from '@platform';

/**
 * Rally adapter binding the shared `@qnsc-vn/identity` {@link BffService} to
 * rally's {@link BffSessionResolver} contract, which the platform
 * {@link JwtAuthGuard} consumes.
 *
 * The shared service resolves a session to the product-neutral core payload;
 * rally flattens it onto its own request principal via {@link toRallyPrincipal},
 * exactly as the Bearer path does. This is the only rally-side seam the hoist
 * requires — the OIDC flow and session lifecycle now live in the package.
 */
@Injectable()
export class RallyBffSessionResolver implements BffSessionResolver {
  constructor(@Inject(BffService) private readonly bff: BffService) {}

  get enabled(): boolean {
    return this.bff.enabled;
  }

  async resolve(sid: string, ip: string): Promise<JwtPayload | null> {
    const core = await this.bff.resolve(sid, ip);
    return core ? toRallyPrincipal(core) : null;
  }

  /**
   * Force a re-mint of the session's tokens without changing the session id.
   *
   * `switchWorkspace` to the workspace the session is *already* in is exactly
   * that operation: the shared service re-runs the claims provider, signs a fresh
   * access token, and writes it back onto the same sid. It also re-validates
   * active workspace membership and account status, so a user who lost access
   * altogether resolves to `null` here instead of silently continuing.
   *
   * Errors are mapped to `null` (deny) rather than propagated: every failure mode
   * — session gone, membership revoked, account suspended — means the caller must
   * re-authenticate, and the guard turns `null` into a 401.
   */
  async remint(sid: string, contextId: string, ip: string): Promise<JwtPayload | null> {
    try {
      const core = await this.bff.switchWorkspace(sid, contextId, ip);
      return core ? toRallyPrincipal(core) : null;
    } catch {
      return null;
    }
  }
}
