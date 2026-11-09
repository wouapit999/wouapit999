import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type AppConfig, decodeEncryptionKey } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Version prefix so the key can be rotated later (`ENCRYPTION_KEYS=v1:...,v2:...`). */
const FORMAT_VERSION = 'v1';

/**
 * Field-level encryption (AES-256-GCM) for secrets at rest (TOTP seeds, secret settings)
 * plus the SHA-256 helpers used for opaque tokens and API keys.
 *
 * Ciphertext format: `v1.<iv b64url>.<ciphertext b64url>.<auth tag b64url>`.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<AppConfig, true>) {
    this.key = decodeEncryptionKey(config.get('ENCRYPTION_KEY', { infer: true }));
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    if (associatedData) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT_VERSION, b64url(iv), b64url(encrypted), b64url(tag)].join('.');
  }

  decrypt(payload: string, associatedData?: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new Error('Malformed ciphertext');
    }
    const [, ivPart, dataPart, tagPart] = parts as [string, string, string, string];
    const iv = fromB64url(ivPart);
    const tag = fromB64url(tagPart);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(fromB64url(dataPart)), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Hex SHA-256 digest: used to store refresh tokens, API keys and reset tokens. */
  sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /** Constant-time comparison of two strings of possibly different length. */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  randomToken(bytes = 32): string {
    return b64url(randomBytes(bytes));
  }
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
