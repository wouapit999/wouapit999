import { createHash } from 'node:crypto';

/**
 * Stable bucket (0–99) for a subject/flag pair. Hashing the flag key together with the user
 * id means a user is not always in the "first 10 %" of every flag.
 */
export function rolloutBucket(flagKey: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${flagKey}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function inRollout(flagKey: string, subjectId: string, percentage: number): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  return rolloutBucket(flagKey, subjectId) < percentage;
}
