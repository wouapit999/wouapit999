/**
 * Idempotent seed for BI-Rem schema v1. Safe to run repeatedly against any environment:
 * every write is an upsert keyed on a natural unique column, and system-role permission
 * sets are reconciled (added *and* removed) against src/permissions.ts.
 *
 * Run with `pnpm --filter @bi-rem/db seed` (or `prisma db seed`, which calls the same
 * command via prisma.config.ts). Requires DATABASE_URL.
 */
import 'dotenv/config';
import { argon2id, hash as argon2Hash, type HashOptions } from 'argon2';

import {
  createPrismaClient,
  PERMISSIONS,
  PERMISSION_KEYS,
  SYSTEM_ROLE_LIST,
  type DbClient,
  type PermissionKey,
  type SystemRoleName,
  type UserRealm,
} from '../src/index.js';
import { buildNotificationTemplates } from './seed-data/notification-templates.js';
import { FEATURE_FLAGS, SETTINGS } from './seed-data/platform-defaults.js';

const DEFAULT_ADMIN_EMAIL = 'admin@bi-rem.local';
const DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!';
const DEFAULT_CUSTOMER_EMAIL = 'customer@bi-rem.local';
const DEFAULT_CUSTOMER_PASSWORD = 'Customer123!';

/** OWASP-aligned Argon2id parameters; must match the API's hashing service. */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

interface SeedUserInput {
  readonly realm: UserRealm;
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly countryCode: string;
  readonly locale: string;
  readonly role: SystemRoleName;
}

interface SeedSummary {
  permissions: number;
  roles: number;
  rolePermissionsAdded: number;
  rolePermissionsRemoved: number;
  users: string[];
  notificationTemplates: number;
  featureFlags: number;
  settings: number;
}

function log(message: string): void {
  console.info(`[seed] ${message}`);
}

async function seedPermissions(db: DbClient): Promise<Map<PermissionKey, string>> {
  const ids = new Map<PermissionKey, string>();
  for (const key of PERMISSION_KEYS) {
    const row = await db.permission.upsert({
      where: { key },
      create: { key, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
      select: { id: true },
    });
    ids.set(key, row.id);
  }
  return ids;
}

async function seedSystemRoles(
  db: DbClient,
  permissionIds: ReadonlyMap<PermissionKey, string>,
): Promise<{ roleIds: Map<SystemRoleName, string>; added: number; removed: number }> {
  const roleIds = new Map<SystemRoleName, string>();
  let added = 0;
  let removed = 0;

  for (const role of SYSTEM_ROLE_LIST) {
    const row = await db.role.upsert({
      where: { name: role.name },
      create: { name: role.name, description: role.description, isSystem: true },
      update: { description: role.description, isSystem: true },
      select: { id: true },
    });
    roleIds.set(role.name, row.id);

    const wantedIds = role.permissions.map((key) => {
      const id = permissionIds.get(key);
      if (!id) {
        throw new Error(`Role ${role.name} references unknown permission "${key}"`);
      }
      return id;
    });

    // Reconcile: system roles are authoritative, so drop grants no longer in the catalogue.
    const removal = await db.rolePermission.deleteMany({
      where: { roleId: row.id, permissionId: { notIn: wantedIds } },
    });
    removed += removal.count;

    const insertion = await db.rolePermission.createMany({
      data: wantedIds.map((permissionId) => ({ roleId: row.id, permissionId })),
      skipDuplicates: true,
    });
    added += insertion.count;
  }

  return { roleIds, added, removed };
}

async function seedUser(
  db: DbClient,
  input: SeedUserInput,
  roleIds: ReadonlyMap<SystemRoleName, string>,
): Promise<string> {
  const roleId = roleIds.get(input.role);
  if (!roleId) {
    throw new Error(`System role ${input.role} was not seeded`);
  }

  const existing = await db.user.findUnique({
    where: { realm_email: { realm: input.realm, email: input.email } },
    select: { id: true },
  });

  let userId: string;
  if (existing) {
    // Never overwrite a password that may have been rotated after the first seed.
    userId = existing.id;
  } else {
    const passwordHash = await argon2Hash(input.password, ARGON2_OPTIONS);
    const created = await db.user.create({
      data: {
        realm: input.realm,
        email: input.email,
        passwordHash,
        status: 'ACTIVE',
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale,
        countryCode: input.countryCode,
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    userId = created.id;
  }

  await db.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    create: { userId, roleId },
    update: {},
  });

  return userId;
}

async function seedNotificationTemplates(db: DbClient): Promise<number> {
  const templates = buildNotificationTemplates();
  for (const template of templates) {
    await db.notificationTemplate.upsert({
      where: {
        key_channel_locale: {
          key: template.key,
          channel: template.channel,
          locale: template.locale,
        },
      },
      create: {
        key: template.key,
        channel: template.channel,
        locale: template.locale,
        subject: template.subject,
        body: template.body,
        variables: [...template.variables],
        isActive: true,
      },
      // Operators may customise copy in the admin portal; only keep the variable list in sync.
      update: { variables: [...template.variables] },
    });
  }
  return templates.length;
}

async function seedFeatureFlags(db: DbClient): Promise<number> {
  for (const flag of FEATURE_FLAGS) {
    await db.featureFlag.upsert({
      where: { key: flag.key },
      create: {
        key: flag.key,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
        rules: flag.rules,
        description: flag.description,
      },
      // Flag state is operational data: never reset it on re-seed, only refresh the description.
      update: { description: flag.description },
    });
  }
  return FEATURE_FLAGS.length;
}

async function seedSettings(db: DbClient): Promise<number> {
  for (const setting of SETTINGS) {
    await db.setting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value,
        isSecret: setting.isSecret,
        description: setting.description,
      },
      update: { description: setting.description, isSecret: setting.isSecret },
    });
  }
  return SETTINGS.length;
}

function resolveAdminCredentials(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SEED_ADMIN_PASSWORD must be set when seeding a production database');
    }
    console.warn(
      `[seed] SEED_ADMIN_PASSWORD not set; using the development default for ${email}. Change it immediately.`,
    );
    return { email, password: DEFAULT_ADMIN_PASSWORD };
  }
  return { email, password };
}

export async function runSeed(db: DbClient): Promise<SeedSummary> {
  const summary: SeedSummary = {
    permissions: 0,
    roles: 0,
    rolePermissionsAdded: 0,
    rolePermissionsRemoved: 0,
    users: [],
    notificationTemplates: 0,
    featureFlags: 0,
    settings: 0,
  };

  const permissionIds = await seedPermissions(db);
  summary.permissions = permissionIds.size;
  log(`permissions: ${summary.permissions}`);

  const { roleIds, added, removed } = await seedSystemRoles(db, permissionIds);
  summary.roles = roleIds.size;
  summary.rolePermissionsAdded = added;
  summary.rolePermissionsRemoved = removed;
  log(`system roles: ${summary.roles} (grants +${added} / -${removed})`);

  const admin = resolveAdminCredentials();
  await seedUser(
    db,
    {
      realm: 'ADMIN',
      email: admin.email,
      password: admin.password,
      firstName: 'Platform',
      lastName: 'Administrator',
      countryCode: 'SN',
      locale: 'en',
      role: 'SUPER_ADMIN',
    },
    roleIds,
  );
  summary.users.push(`${admin.email} (ADMIN / SUPER_ADMIN)`);

  if (process.env.NODE_ENV !== 'production') {
    const customerEmail = process.env.SEED_CUSTOMER_EMAIL ?? DEFAULT_CUSTOMER_EMAIL;
    await seedUser(
      db,
      {
        realm: 'CUSTOMER',
        email: customerEmail,
        password: process.env.SEED_CUSTOMER_PASSWORD ?? DEFAULT_CUSTOMER_PASSWORD,
        firstName: 'Awa',
        lastName: 'Diop',
        countryCode: 'SN',
        locale: 'fr',
        role: 'CUSTOMER',
      },
      roleIds,
    );
    summary.users.push(`${customerEmail} (CUSTOMER / CUSTOMER)`);
  }
  log(`users: ${summary.users.join(', ')}`);

  summary.notificationTemplates = await seedNotificationTemplates(db);
  log(`notification templates: ${summary.notificationTemplates}`);

  summary.featureFlags = await seedFeatureFlags(db);
  log(`feature flags: ${summary.featureFlags}`);

  summary.settings = await seedSettings(db);
  log(`settings: ${summary.settings}`);

  return summary;
}

async function main(): Promise<void> {
  const db = createPrismaClient(undefined, { maxConnections: 2 });
  try {
    await runSeed(db);
    log('done');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
