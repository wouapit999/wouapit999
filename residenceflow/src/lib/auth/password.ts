import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;
let dummyHash: string | undefined;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string | null | undefined) {
  if (!hash) {
    // Constant-ish time: still run a comparison to avoid user enumeration by timing.
    dummyHash ??= await bcrypt.hash("timing-equaliser", COST);
    await bcrypt.compare(plain, dummyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** Validates a new password against the organization policy. Returns error keys. */
export function passwordPolicyErrors(password: string, minLength: number): string[] {
  const errors: string[] = [];
  if (password.length < minLength) errors.push("password.tooShort");
  if (password.length > 128) errors.push("password.tooLong");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) errors.push("password.complexity");
  return errors;
}

export async function isReusedPassword(plain: string, history: string[]) {
  for (const h of history) if (await bcrypt.compare(plain, h)) return true;
  return false;
}

export const passwordSchema = z.string().min(8).max(128);
