import { Injectable } from '@nestjs/common';
import type { IClaimsProvider, ProductClaims } from '@qnsc-vn/identity';
import { AuthzEpochService } from '@platform';
import { AccessService } from '@modules/access';

/**
 * Rally's {@link IClaimsProvider}. Rally is permission-based (PBAC), so the
 * authorization claims embedded in every access token are the user's effective
 * permission codes, resolved for the active workspace (`contextId`). Called by
 * the shared auth core on every token mint, so permissions are refreshed on
 * each rotation and bounded by the access-token TTL.
 *
 * Every token also carries the `authzEpoch` those permissions were resolved at.
 * The platform JwtAuthGuard compares it against the live epoch, which is what
 * lets a revoked permission take effect on the user's *next request* rather than
 * at token expiry. Reading the epoch here — not at check time — is what makes the
 * comparison meaningful: the pair (permissions, epoch) is captured together.
 */
@Injectable()
export class RallyClaimsProvider implements IClaimsProvider {
  constructor(
    private readonly access: AccessService,
    private readonly authzEpoch: AuthzEpochService,
  ) {}

  async getClaims(userId: string, contextId?: string | null): Promise<ProductClaims> {
    const [{ permissions }, epoch] = await Promise.all([
      this.access.getUserRoleAndPermissions(userId, contextId ?? ''),
      this.authzEpoch.current(userId),
    ]);
    // An unreadable epoch stamps 0, so the token is treated as pre-epoch and the
    // next bump invalidates it. Stamping a guessed value would do the opposite —
    // mint a token that outlives the change it should have seen.
    return { permissions, authzEpoch: epoch ?? 0 };
  }
}
