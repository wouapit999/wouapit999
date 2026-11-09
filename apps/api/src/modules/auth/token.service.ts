import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { UserRealm } from '@bi-rem/db';
import { generateOpaqueToken } from '@bi-rem/shared';

import { ApiException } from '../../common/errors/api-exception.js';
import type { AppConfig } from '../../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { TokenPurpose } from './auth.constants.js';

export interface AccessTokenClaims {
  sub: string;
  realm: UserRealm;
  email: string;
  roles: string[];
  permissions: string[];
  /** Session id = id of the refresh-token row this access token belongs to. */
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

export type AccessTokenInput = Omit<AccessTokenClaims, 'jti' | 'iat' | 'exp'>;

export interface PurposeTokenClaims {
  sub: string;
  purpose: TokenPurpose;
  /** Fingerprint binding the token to the current credential state (single use). */
  fp?: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Signs/verifies JWTs and generates/hashes opaque tokens. Stateless by design. */
@Injectable()
export class TokenService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.accessTtl = config.get('jwtAccessTtlSeconds', { infer: true });
    this.refreshTtl = config.get('jwtRefreshTtlSeconds', { infer: true });
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  get accessTtlSeconds(): number {
    return this.accessTtl;
  }

  get refreshTtlSeconds(): number {
    return this.refreshTtl;
  }

  signAccessToken(input: AccessTokenInput): Promise<string> {
    return this.jwt.signAsync({ ...input, jti: randomUUID() }, { expiresIn: this.accessTtl });
  }

  /** Opaque, URL-safe refresh token (256 bits) and the hash stored in `refresh_tokens.token_hash`. */
  generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = generateOpaqueToken(32);
    return {
      token,
      hash: this.hashToken(token),
      expiresAt: new Date(Date.now() + this.refreshTtl * 1_000),
    };
  }

  hashToken(token: string): string {
    return this.crypto.sha256(token);
  }

  /** Short-lived single-purpose tokens (MFA challenge, password reset, invitation). */
  signPurposeToken(
    subject: string,
    purpose: TokenPurpose,
    ttlSeconds: number,
    fingerprint?: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: subject, purpose, ...(fingerprint ? { fp: fingerprint } : {}), jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: ttlSeconds },
    );
  }

  async verifyPurposeToken(token: string, purpose: TokenPurpose): Promise<PurposeTokenClaims> {
    let claims: PurposeTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<PurposeTokenClaims>(token, {
        secret: this.refreshSecret,
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) throw ApiException.tokenExpired();
      throw ApiException.unauthenticated('Invalid token');
    }
    if (claims.purpose !== purpose || typeof claims.sub !== 'string') {
      throw ApiException.unauthenticated('Invalid token');
    }
    return claims;
  }

  /** Fingerprint of the credential state; changes whenever the password hash changes. */
  credentialFingerprint(passwordHash: string): string {
    return this.crypto.sha256(passwordHash).slice(0, 24);
  }
}
