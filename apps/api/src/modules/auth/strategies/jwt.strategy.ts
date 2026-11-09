import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedPrincipal } from '../../../common/auth/principal.js';
import { ApiException } from '../../../common/errors/api-exception.js';
import type { AppConfig } from '../../../config/env.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { JWT_ISSUER } from '../auth.constants.js';
import type { AccessTokenClaims } from '../token.service.js';

/**
 * Bearer access-token strategy. Besides signature/expiry, it checks that the session the
 * token was issued for is still alive, so logout and password resets take effect immediately
 * instead of at access-token expiry.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
    });
  }

  async validate(claims: AccessTokenClaims): Promise<AuthenticatedPrincipal> {
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
      throw ApiException.unauthenticated('Malformed access token');
    }
    const session = await this.prisma.client.refreshToken.findUnique({
      where: { id: claims.sid },
      select: {
        revokedAt: true,
        userId: true,
        user: { select: { status: true, deletedAt: true, realm: true, email: true } },
      },
    });
    if (session?.userId !== claims.sub) throw ApiException.tokenRevoked('Session not found');
    if (session.revokedAt) throw ApiException.tokenRevoked('Session has been revoked');
    const { user } = session;
    if (
      user.deletedAt ||
      user.status === 'DELETED' ||
      user.status === 'SUSPENDED' ||
      user.status === 'LOCKED'
    ) {
      throw ApiException.tokenRevoked('Account is not active');
    }
    return {
      type: 'USER',
      id: claims.sub,
      userId: claims.sub,
      apiKeyId: null,
      realm: user.realm,
      email: user.email,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
      permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
      sessionId: claims.sid,
    };
  }
}
