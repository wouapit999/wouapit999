import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id parameters aligned with OWASP guidance and with `packages/db/prisma/seed.ts`
 * (hashes produced by the seed must verify here and vice versa).
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash of a random password used to equalise timing when the user does not exist. */
const DUMMY_HASH_INPUT = 'bi-rem-dummy-password-for-timing-equalisation';

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same CPU as a real verification so unknown e-mails are not distinguishable by timing. */
  async burn(password: string): Promise<void> {
    this.dummyHash ??= this.hash(DUMMY_HASH_INPUT);
    await this.verify(await this.dummyHash, password);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
