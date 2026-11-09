import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'prisma', 'migrations');
const schemaPath = join(here, '..', 'prisma', 'schema.prisma');

/** Table names (`@@map`) for every schema v1 entity listed in CLAUDE.md. */
const EXPECTED_TABLES = [
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'refresh_tokens',
  'audit_logs',
  'notifications',
  'notification_templates',
  'notification_preferences',
  'feature_flags',
  'settings',
  'api_keys',
  'outbox',
] as const;

const EXPECTED_ENUMS = [
  'user_realm',
  'user_status',
  'audit_actor_type',
  'audit_outcome',
  'notification_channel',
  'notification_status',
  'outbox_status',
] as const;

function readInitialMigration(): string {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const initial = dirs[0];
  if (initial === undefined) {
    throw new Error(`No migrations found in ${migrationsDir}`);
  }
  expect(initial).toMatch(/^\d{14}_init$/);
  return readFileSync(join(migrationsDir, initial, 'migration.sql'), 'utf8');
}

describe('initial migration', () => {
  const sql = readInitialMigration();

  it('enables the Postgres extensions the schema relies on', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS "citext";/);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/);
  });

  it.each(EXPECTED_TABLES)('creates table "%s"', (table) => {
    expect(sql).toContain(`CREATE TABLE "${table}" (`);
  });

  it('creates exactly the schema v1 tables', () => {
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_]+)" \(/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it.each(EXPECTED_ENUMS)('creates enum type "%s"', (enumName) => {
    expect(sql).toContain(`CREATE TYPE "${enumName}" AS ENUM (`);
  });

  it('uses uuid primary keys with gen_random_uuid() and timestamptz columns', () => {
    const uuidDefaults = sql.match(/"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/g) ?? [];
    // Join tables (user_roles, role_permissions) use composite keys and have no "id".
    expect(uuidDefaults.length).toBe(EXPECTED_TABLES.length - 2);
    expect(sql).toContain('TIMESTAMPTZ(6)');
    expect(sql).not.toMatch(/TIMESTAMP\(\d\)/);
    expect(sql).toContain('"email" CITEXT NOT NULL');
  });

  it('declares the required indexes', () => {
    expect(sql).toContain('ON "users"("realm", "email")');
    expect(sql).toContain('ON "audit_logs"("resource_type", "resource_id")');
    expect(sql).toContain('ON "audit_logs"("actor_user_id")');
    expect(sql).toContain('ON "audit_logs"("created_at")');
    expect(sql).toContain('ON "audit_logs"("correlation_id")');
    expect(sql).toContain('ON "outbox"("status", "created_at")');
    expect(sql).toContain('ON "notification_templates"("key", "channel", "locale")');
    expect(sql).toContain('ON "notification_preferences"("user_id", "channel")');
  });

  it('matches the models declared in schema.prisma', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const mappedTables = [...schema.matchAll(/^\s*@@map\("([a-z_]+)"\)/gm)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined)
      .filter((name) => !(EXPECTED_ENUMS as readonly string[]).includes(name));
    expect(mappedTables.sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('ships a postgresql migration lock file', () => {
    const lock = readFileSync(join(migrationsDir, 'migration_lock.toml'), 'utf8');
    expect(lock).toMatch(/provider\s*=\s*"postgresql"/);
  });
});
