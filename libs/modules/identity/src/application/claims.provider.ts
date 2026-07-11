import { Injectable } from '@nestjs/common';
import type { IClaimsProvider, ProductClaims } from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';

/**
 * Rally's {@link IClaimsProvider}. Rally is permission-based (PBAC), so the
 * authorization claims embedded in every access token are the user's effective
 * permission codes, resolved for the active workspace (`contextId`). Called by
 * the shared auth core on every token mint, so permissions are refreshed on
 * each rotation and bounded by the access-token TTL.
 */
@Injectable()
export class RallyClaimsProvider implements IClaimsProvider {
  constructor(private readonly access: AccessService) {}

  async getClaims(userId: string, contextId?: string | null): Promise<ProductClaims> {
    const { permissions } = await this.access.getUserRoleAndPermissions(userId, contextId ?? '');
    return { permissions };
  }
}
