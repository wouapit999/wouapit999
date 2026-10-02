/**
 * Emergency administrator reset, run from a trusted workstation against the database:
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/admin-reset.ts admin@example.com
 * Sets a random temporary password (shown once), forces a change at next login, unlocks the
 * account, clears MFA if --clear-mfa is given, revokes all sessions, and writes an audit entry.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const db = new PrismaClient();
const email = process.argv[2]?.toLowerCase();
const clearMfa = process.argv.includes("--clear-mfa");

async function main() {
  if (!email) throw new Error("Usage: npx tsx scripts/admin-reset.ts <email> [--clear-mfa]");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}`);
  const temp = `Tmp-${randomBytes(9).toString("base64url")}!9`;
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(temp, 12),
        mustChangePassword: true,
        status: user.status === "ARCHIVED" ? "ACTIVE" : user.status === "SUSPENDED" ? "ACTIVE" : user.status,
        failedLoginCount: 0,
        lockedUntil: null,
        ...(clearMfa ? { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] } : {}),
      },
    }),
    db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorName: "operator (scripts/admin-reset.ts)",
        action: "auth.admin_reset_by_operator",
        module: "auth",
        entityType: "User",
        entityId: user.id,
        metadata: { clearMfa },
      },
    }),
  ]);
  console.log(`\nTemporary password for ${email}: ${temp}\nThe user must set a new password at next login.${clearMfa ? " Two-step verification was cleared." : ""}\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
