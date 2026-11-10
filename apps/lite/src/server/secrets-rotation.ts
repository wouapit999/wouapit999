import { reencryptSecret, secretKeyVersion } from './crypto';
import type { DbOrTx } from './db';
import { getEnv } from './env';

/**
 * Bulk re-encryption after an `ENCRYPTION_KEY` rotation.
 *
 * Rotation is: add the old key to `ENCRYPTION_KEYS_PREVIOUS`, set the new `ENCRYPTION_KEY` and
 * bump `ENCRYPTION_KEY_VERSION`. Reads keep working because every envelope names the key version
 * it was written with. This pass rewrites every stored envelope that still uses an older version
 * with the current key, so the old key can be removed from `ENCRYPTION_KEYS_PREVIOUS` afterwards.
 *
 * It runs at the end of the seed (every deploy) and is idempotent: with nothing to do it only
 * reads. Plaintext never leaves this process and is never logged.
 */

export interface ReencryptionReport {
  /** Rows rewritten with the current key, per table. */
  readonly rewritten: { providerSecrets: number; mfaSecrets: number; webhookEndpoints: number };
  /** Rows already on the current key version. */
  readonly current: number;
  /**
   * Rows that could not be decrypted (their key version is not configured, or the data is
   * corrupt), as `<table>:<id>`. They are left untouched.
   */
  readonly unreadable: string[];
  /** Key versions still referenced by a stored envelope after the pass, ascending. */
  readonly versionsInUse: number[];
}

interface Envelope {
  readonly table: 'provider_secrets' | 'users' | 'webhook_endpoints';
  readonly id: string;
  readonly value: string;
}

async function loadEnvelopes(client: DbOrTx): Promise<Envelope[]> {
  const [providerSecrets, users, endpoints] = await Promise.all([
    client.providerSecret.findMany({ select: { id: true, ciphertext: true } }),
    client.user.findMany({
      where: { mfaSecretEnc: { not: null } },
      select: { id: true, mfaSecretEnc: true },
    }),
    client.webhookEndpoint.findMany({ select: { id: true, secretEnc: true } }),
  ]);
  return [
    ...providerSecrets.map((row): Envelope => ({
      table: 'provider_secrets',
      id: row.id,
      value: row.ciphertext,
    })),
    ...users.flatMap((row): Envelope[] =>
      row.mfaSecretEnc ? [{ table: 'users', id: row.id, value: row.mfaSecretEnc }] : [],
    ),
    ...endpoints.map((row): Envelope => ({
      table: 'webhook_endpoints',
      id: row.id,
      value: row.secretEnc,
    })),
  ];
}

/**
 * Writes `fresh` only if the row still holds `previous`, so a secret saved by someone else
 * between the read and the write is never overwritten. Returns whether the row was updated.
 */
async function swap(
  client: DbOrTx,
  envelope: Envelope,
  fresh: string,
  keyVersion: number,
): Promise<boolean> {
  const { id, value: previous } = envelope;
  switch (envelope.table) {
    case 'provider_secrets':
      return (
        (
          await client.providerSecret.updateMany({
            where: { id, ciphertext: previous },
            data: { ciphertext: fresh, keyVersion },
          })
        ).count === 1
      );
    case 'users':
      return (
        (
          await client.user.updateMany({
            where: { id, mfaSecretEnc: previous },
            data: { mfaSecretEnc: fresh },
          })
        ).count === 1
      );
    case 'webhook_endpoints':
      return (
        (
          await client.webhookEndpoint.updateMany({
            where: { id, secretEnc: previous },
            data: { secretEnc: fresh },
          })
        ).count === 1
      );
  }
}

/** Re-encrypts every stored secret that is not on the current key version. Idempotent. */
export async function reencryptStoredSecrets(client: DbOrTx): Promise<ReencryptionReport> {
  const currentVersion = getEnv().encryptionKeyVersion;
  const rewritten = { providerSecrets: 0, mfaSecrets: 0, webhookEndpoints: 0 };
  const unreadable: string[] = [];
  const versionsInUse = new Set<number>();
  let current = 0;

  for (const envelope of await loadEnvelopes(client)) {
    let fresh: string;
    try {
      if (secretKeyVersion(envelope.value) === currentVersion) {
        current += 1;
        versionsInUse.add(currentVersion);
        continue;
      }
      fresh = reencryptSecret(envelope.value);
    } catch {
      // Left as it is, and reported by id only: no detail of a failed decryption in a build log.
      unreadable.push(`${envelope.table}:${envelope.id}`);
      try {
        versionsInUse.add(secretKeyVersion(envelope.value));
      } catch {
        // Not an envelope at all.
      }
      continue;
    }
    // A row replaced concurrently was written with the current key by whoever saved it.
    versionsInUse.add(currentVersion);
    if (!(await swap(client, envelope, fresh, currentVersion))) continue;
    if (envelope.table === 'provider_secrets') rewritten.providerSecrets += 1;
    else if (envelope.table === 'users') rewritten.mfaSecrets += 1;
    else rewritten.webhookEndpoints += 1;
  }

  return {
    rewritten,
    current,
    unreadable,
    versionsInUse: [...versionsInUse].sort((a, b) => a - b),
  };
}
