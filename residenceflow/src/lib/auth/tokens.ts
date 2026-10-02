import "server-only";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/notify/email";
import { hashToken, randomToken } from "./crypto";

/** Creates a single-use, short-lived token; only the hash is stored. Returns the full link. */
export async function issueResetToken(userId: string, purpose: "RESET" | "ACTIVATION", minutes: number) {
  const token = randomToken();
  await db.passwordResetToken.updateMany({ where: { userId, usedAt: null, purpose }, data: { usedAt: new Date() } });
  await db.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), purpose, expiresAt: new Date(Date.now() + minutes * 60_000) } });
  const path = purpose === "RESET" ? "reset-password" : "activate-account";
  return `${appBaseUrl()}/${path}/${token}`;
}

