import { Injectable, Logger } from '@nestjs/common';
import {
  type ApiKey,
  hasPermission,
  isPermissionKey,
  permissionsForResource,
  type PermissionResource,
} from '@bi-rem/db';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PermissionResolverService } from '../rbac/permission-resolver.service.js';
import { SUPER_ADMIN_ROLE } from '../rbac/permissions.guard.js';
import type { CreateApiKeyDto } from './dto/api-key.dto.js';

export const API_KEY_PREFIX = 'brk_live_';
const PREFIX_LENGTH = 16;
/** Minimum spacing between `lastUsedAt` writes for the same key. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdById: string;
  createdAt: Date;
}

export interface CreatedApiKey extends ApiKeyView {
  /** Plaintext secret, returned exactly once. */
  key: string;
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly resolver: PermissionResolverService,
  ) {}

  async list(): Promise<ApiKeyView[]> {
    const keys = await this.prisma.client.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return keys.map(toView);
  }

  async get(id: string): Promise<ApiKeyView> {
    const key = await this.prisma.client.apiKey.findUnique({ where: { id } });
    if (!key) throw ApiException.notFound('API key not found');
    return toView(key);
  }

  async create(dto: CreateApiKeyDto, actor: AuthenticatedPrincipal): Promise<CreatedApiKey> {
    const createdById = actor.userId;
    if (actor.type !== 'USER' || !createdById) {
      throw ApiException.forbidden('API keys must be created by a user account');
    }
    const invalid = dto.scopes.filter((scope) => !isValidScope(scope));
    if (invalid.length) {
      throw ApiException.badRequest(
        'Unknown permission scopes',
        invalid.map((scope) => ({ path: 'scopes', message: `Unknown scope ${scope}` })),
      );
    }
    await this.assertScopesWithinGrant(dto.scopes, createdById);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw ApiException.badRequest('expiresAt must be in the future');
    }
    const plaintext = `${API_KEY_PREFIX}${this.crypto.randomToken(32)}`;
    const row = await this.prisma.client.apiKey.create({
      data: {
        name: dto.name,
        keyHash: this.crypto.sha256(plaintext),
        prefix: plaintext.slice(0, PREFIX_LENGTH),
        scopes: dto.scopes,
        expiresAt,
        createdById,
      },
    });
    RequestContext.setResourceId(row.id);
    RequestContext.recordAfter(toView(row));
    return { ...toView(row), key: plaintext };
  }

  async revoke(id: string): Promise<ApiKeyView> {
    const key = await this.prisma.client.apiKey.findUnique({ where: { id } });
    if (!key) throw ApiException.notFound('API key not found');
    if (key.revokedAt) return toView(key);
    RequestContext.recordBefore(toView(key));
    const updated = await this.prisma.client.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    RequestContext.recordAfter(toView(updated));
    return toView(updated);
  }

  /** Validates a raw `x-api-key` value and returns the principal it represents, or null. */
  async authenticate(rawKey: string): Promise<AuthenticatedPrincipal | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX) || rawKey.length > 256) return null;
    const key = await this.prisma.client.apiKey.findUnique({
      where: { keyHash: this.crypto.sha256(rawKey) },
    });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
    this.touch(key.id);
    return {
      type: 'API_KEY',
      id: key.id,
      userId: null,
      apiKeyId: key.id,
      realm: 'ADMIN',
      email: null,
      roles: [],
      permissions: key.scopes,
      sessionId: null,
    };
  }

  /**
   * A key can never carry more authority than the user minting it: every requested scope must be
   * covered by the creator's effective permissions (SUPER_ADMIN may mint any scope, `*` included).
   */
  private async assertScopesWithinGrant(scopes: readonly string[], userId: string): Promise<void> {
    const { roles, permissions } = await this.resolver.resolve(userId);
    if (roles.includes(SUPER_ADMIN_ROLE)) return;
    const missing: string[] = [];
    for (const scope of scopes) {
      if (scope === '*') {
        missing.push(scope);
      } else if (scope.endsWith(':*')) {
        const resource = scope.slice(0, -2) as PermissionResource;
        const covered = permissionsForResource(resource);
        if (covered.length === 0 || !covered.every((key) => hasPermission(permissions, key)))
          missing.push(scope);
      } else if (!isPermissionKey(scope) || !hasPermission(permissions, scope)) {
        missing.push(scope);
      }
    }
    if (missing.length) {
      throw ApiException.forbidden(
        `You cannot grant scopes you do not hold yourself: ${missing.join(', ')}`,
      );
    }
  }

  private touch(id: string): void {
    const last = this.lastUsedWrites.get(id) ?? 0;
    const now = Date.now();
    if (now - last < LAST_USED_WRITE_INTERVAL_MS) return;
    this.lastUsedWrites.set(id, now);
    this.prisma.client.apiKey
      .update({ where: { id }, data: { lastUsedAt: new Date(now) } })
      .catch((error: unknown) =>
        this.logger.warn({ err: error }, 'Failed to update API key lastUsedAt'),
      );
  }
}

function isValidScope(scope: string): boolean {
  if (scope === '*') return true;
  if (scope.endsWith(':*')) return true;
  return isPermissionKey(scope);
}

function toView(key: ApiKey): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdById: key.createdById,
    createdAt: key.createdAt,
  };
}
