import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Algorithm } from 'jsonwebtoken';
import { AppConfigService } from '../config/app-config.service';

export interface JwtPayload {
  /** Subject = userId */
  sub: string;
  tenantId: string;
  sessionId: string;
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
  /**
   * Effective permission codes for this user, embedded at token-mint time.
   * Refreshed on every token rotation so stale permissions are bounded by
   * the access-token TTL (default 15 min).
   */
  permissions: string[];
  /**
   * How the session was originally established.
   * 'sso': via Entra ID — frontend must re-validate with MSAL on each refresh cycle.
   * 'password': credential-based — standard Rally refresh rotation.
   */
  authMethod: 'password' | 'sso';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['ES256'] as Algorithm[],
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    // Denylist check (Valkey) happens in a separate guard or here via injection
    // Returning payload attaches it to request.user
    return payload;
  }
}
