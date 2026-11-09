import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Setting } from '@bi-rem/db';

import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { UpsertSettingDto } from './dto/setting.dto.js';

export interface SettingView {
  id: string;
  key: string;
  /** `null` for secrets unless explicitly revealed. */
  value: unknown;
  isSecret: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EncryptedEnvelope {
  __encrypted: string;
}

interface CacheEntry {
  value: unknown;
  present: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Typed read with fallback; used by other services (lockout policy, default locale…). */
  async getValue<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now())
      return cached.present ? (cached.value as T) : fallback;
    try {
      const row = await this.prisma.client.setting.findUnique({ where: { key } });
      const value = row ? this.decode(row) : undefined;
      this.cache.set(key, { value, present: row !== null, expiresAt: Date.now() + CACHE_TTL_MS });
      return row ? (value as T) : fallback;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Setting lookup failed; using fallback');
      return fallback;
    }
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.getValue<unknown>(key, fallback);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.client.setting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((row) => this.toView(row, false));
  }

  async get(key: string, reveal = false): Promise<SettingView> {
    const row = await this.prisma.client.setting.findUnique({ where: { key } });
    if (!row) throw ApiException.notFound(`Setting ${key} not found`);
    return this.toView(row, reveal);
  }

  async upsert(key: string, dto: UpsertSettingDto): Promise<SettingView> {
    const existing = await this.prisma.client.setting.findUnique({ where: { key } });
    if (existing) RequestContext.recordBefore(this.toView(existing, false));
    // Pre-register a redacted "after" snapshot so a failure before the write never leaks the
    // secret value into the audit row (the interceptor would otherwise fall back to the body).
    RequestContext.recordAfter({
      key,
      isSecret: dto.isSecret,
      value: dto.isSecret ? null : dto.value,
    });
    const stored = dto.isSecret ? this.encode(dto.value) : (dto.value as Prisma.InputJsonValue);
    const saved = await this.prisma.client.setting.upsert({
      where: { key },
      update: {
        value: stored,
        isSecret: dto.isSecret,
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      create: { key, value: stored, isSecret: dto.isSecret, description: dto.description ?? null },
    });
    this.cache.delete(key);
    RequestContext.setResourceId(saved.id);
    const view = this.toView(saved, false);
    RequestContext.recordAfter(view);
    return view;
  }

  async remove(key: string): Promise<void> {
    const row = await this.prisma.client.setting.findUnique({ where: { key } });
    if (!row) throw ApiException.notFound(`Setting ${key} not found`);
    RequestContext.recordBefore(this.toView(row, false));
    RequestContext.setResourceId(row.id);
    await this.prisma.client.setting.delete({ where: { key } });
    this.cache.delete(key);
  }

  private encode(value: unknown): Prisma.InputJsonValue {
    const envelope: EncryptedEnvelope = { __encrypted: this.crypto.encrypt(JSON.stringify(value)) };
    return envelope as unknown as Prisma.InputJsonValue;
  }

  private decode(row: Setting): unknown {
    if (!row.isSecret) return row.value;
    const envelope = row.value as Partial<EncryptedEnvelope> | null;
    if (!envelope || typeof envelope.__encrypted !== 'string') return row.value;
    return JSON.parse(this.crypto.decrypt(envelope.__encrypted)) as unknown;
  }

  private toView(row: Setting, reveal: boolean): SettingView {
    return {
      id: row.id,
      key: row.key,
      value: row.isSecret && !reveal ? null : this.decode(row),
      isSecret: row.isSecret,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
