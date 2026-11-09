import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';

import type { AppConfig } from '../../config/env.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { TOTP_EPOCH_TOLERANCE_SECONDS } from './auth.constants.js';

export interface TotpEnrolment {
  /** Base32 secret to show once (manual entry fallback). */
  secret: string;
  /** otpauth:// URI to render as a QR code. */
  otpauthUri: string;
  /** Encrypted form to persist in `users.mfa_secret`. */
  encryptedSecret: string;
}

/**
 * RFC 6238 TOTP helpers. Secrets are encrypted at rest with AES-256-GCM, bound to the user id
 * as associated data so a ciphertext copied between rows cannot be decrypted.
 */
@Injectable()
export class MfaService {
  private readonly issuer: string;

  constructor(
    private readonly crypto: CryptoService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.issuer = config.get('APP_NAME', { infer: true });
  }

  enrol(userId: string, accountLabel: string): TotpEnrolment {
    const secret = generateSecret();
    return {
      secret,
      otpauthUri: generateURI({ issuer: this.issuer, label: accountLabel, secret }),
      encryptedSecret: this.crypto.encrypt(secret, userId),
    };
  }

  /** Verifies a 6-digit code against the stored (encrypted) secret. */
  verify(userId: string, encryptedSecret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    let secret: string;
    try {
      secret = this.crypto.decrypt(encryptedSecret, userId);
    } catch {
      return false;
    }
    try {
      return verifySync({ secret, token: code, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS })
        .valid;
    } catch {
      return false;
    }
  }
}
