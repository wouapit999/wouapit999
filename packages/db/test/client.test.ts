import { describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  DatabaseConfigurationError,
  NotificationChannel,
  resolveDatabaseUrl,
  UserRealm,
  UserStatus,
} from '../src/index.js';

describe('resolveDatabaseUrl', () => {
  it('strips the Prisma-only schema parameter and returns it separately', () => {
    const resolved = resolveDatabaseUrl(
      'postgresql://birem:birem@localhost:5432/birem?schema=public&sslmode=require',
    );
    expect(resolved.schema).toBe('public');
    expect(resolved.connectionString).toBe(
      'postgresql://birem:birem@localhost:5432/birem?sslmode=require',
    );
  });

  it('accepts the postgres:// alias and leaves schema undefined when absent', () => {
    const resolved = resolveDatabaseUrl('postgres://u:p@db.example.com/birem');
    expect(resolved.schema).toBeUndefined();
    expect(resolved.connectionString).toBe('postgres://u:p@db.example.com/birem');
  });

  it('rejects malformed or non-postgres URLs', () => {
    expect(() => resolveDatabaseUrl('not a url')).toThrow(DatabaseConfigurationError);
    expect(() => resolveDatabaseUrl('mysql://u:p@host/db')).toThrow(DatabaseConfigurationError);
  });
});

describe('createPrismaClient', () => {
  it('throws a configuration error when no URL is available', () => {
    expect(() => createPrismaClient(undefined)).toThrow(DatabaseConfigurationError);
  });

  it('constructs a client without connecting', async () => {
    // The pg pool connects lazily, so building the client never touches the network.
    const client = createPrismaClient('postgresql://u:p@localhost:5432/birem?schema=public', {
      maxConnections: 1,
    });
    expect(client).toBeDefined();
    expect(typeof client.user.findMany).toBe('function');
    await client.$disconnect();
  });
});

describe('generated enums', () => {
  it('re-exports the schema v1 enums', () => {
    expect(Object.values(UserRealm).sort()).toEqual(['ADMIN', 'CUSTOMER']);
    expect(Object.values(UserStatus).sort()).toEqual(
      ['PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DELETED'].sort(),
    );
    expect(Object.values(NotificationChannel).sort()).toEqual(
      ['EMAIL', 'SMS', 'PUSH', 'IN_APP'].sort(),
    );
  });
});
