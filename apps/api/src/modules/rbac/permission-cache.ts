import type { Redis } from 'ioredis';

export interface ResolvedPermissions {
  roles: string[];
  permissions: string[];
}

export const PERMISSION_CACHE = Symbol('PERMISSION_CACHE');
export const PERMISSION_CACHE_TTL_SECONDS = 60;

/** Pluggable cache for a user's effective roles/permissions. */
export interface PermissionCacheStore {
  get(userId: string): Promise<ResolvedPermissions | null>;
  set(userId: string, value: ResolvedPermissions, ttlSeconds: number): Promise<void>;
  invalidate(userId: string): Promise<void>;
  invalidateAll(): Promise<void>;
}

interface Entry {
  value: ResolvedPermissions;
  expiresAt: number;
}

export class InMemoryPermissionCache implements PermissionCacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get(userId: string): Promise<ResolvedPermissions | null> {
    const entry = this.entries.get(userId);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(userId);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(userId: string, value: ResolvedPermissions, ttlSeconds: number): Promise<void> {
    this.entries.set(userId, { value, expiresAt: this.now() + ttlSeconds * 1_000 });
    return Promise.resolve();
  }

  invalidate(userId: string): Promise<void> {
    this.entries.delete(userId);
    return Promise.resolve();
  }

  invalidateAll(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }
}

export class RedisPermissionCache implements PermissionCacheStore {
  private static readonly PREFIX = 'birem:perm:';

  constructor(private readonly redis: Redis) {}

  async get(userId: string): Promise<ResolvedPermissions | null> {
    const raw = await this.redis.get(RedisPermissionCache.PREFIX + userId);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ResolvedPermissions;
    } catch {
      return null;
    }
  }

  async set(userId: string, value: ResolvedPermissions, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      RedisPermissionCache.PREFIX + userId,
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }

  async invalidate(userId: string): Promise<void> {
    await this.redis.del(RedisPermissionCache.PREFIX + userId);
  }

  async invalidateAll(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${RedisPermissionCache.PREFIX}*`,
        'COUNT',
        200,
      );
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }
}
