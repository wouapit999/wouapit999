import { Injectable } from '@nestjs/common';
import type { FeatureFlag, Prisma } from '@bi-rem/db';
import { FEATURE_FLAG_DEFAULTS, isFeatureFlagKey } from '@bi-rem/shared';

import { RequestContext } from '../../common/context/request-context.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { FeatureFlagRuleDto, UpsertFeatureFlagDto } from './dto/feature-flag.dto.js';
import { inRollout } from './rollout.js';

export interface FlagContext {
  userId?: string | null;
  realm?: string | null;
  countryCode?: string | null;
  email?: string | null;
  roles?: readonly string[];
}

interface CacheEntry {
  flag: FeatureFlag | null;
  expiresAt: number;
}

/** Read-through cache TTL; writes through this service invalidate immediately. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class FeatureFlagsService {
  private readonly cache = new Map<string, CacheEntry>();
  /** Clock source, overridable in tests to exercise cache expiry. */
  now: () => number = Date.now;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluation order: flag row missing → shared default (or false); `enabled` false → false;
   * any targeting rule matches → true; otherwise percentage rollout bucketed on the user id
   * (anonymous subjects only pass at 100 %).
   */
  async isEnabled(key: string, context: FlagContext = {}): Promise<boolean> {
    const flag = await this.getFlag(key);
    if (!flag) return isFeatureFlagKey(key) ? FEATURE_FLAG_DEFAULTS[key] : false;
    return FeatureFlagsService.evaluate(flag, context);
  }

  static evaluate(
    flag: Pick<FeatureFlag, 'key' | 'enabled' | 'rolloutPercentage' | 'rules'>,
    context: FlagContext,
  ): boolean {
    if (!flag.enabled) return false;
    const rules = Array.isArray(flag.rules) ? (flag.rules as unknown as FeatureFlagRuleDto[]) : [];
    if (rules.length && rules.some((rule) => matchesRule(rule, context))) return true;
    if (flag.rolloutPercentage >= 100) return true;
    if (!context.userId) return false;
    return inRollout(flag.key, context.userId, flag.rolloutPercentage);
  }

  /** Evaluates every stored flag plus shared defaults for a subject (portal bootstrap). */
  async evaluateAll(context: FlagContext): Promise<Record<string, boolean>> {
    const flags = await this.prisma.client.featureFlag.findMany();
    const result: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
    for (const flag of flags) result[flag.key] = FeatureFlagsService.evaluate(flag, context);
    return result;
  }

  list(): Promise<FeatureFlag[]> {
    return this.prisma.client.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async get(key: string): Promise<FeatureFlag> {
    const flag = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (!flag) throw ApiException.notFound(`Feature flag ${key} not found`);
    return flag;
  }

  async upsert(key: string, dto: UpsertFeatureFlagDto): Promise<FeatureFlag> {
    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    if (existing) RequestContext.recordBefore(existing);
    const data = {
      enabled: dto.enabled,
      rolloutPercentage: dto.rolloutPercentage,
      rules: dto.rules as unknown as Prisma.InputJsonValue,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };
    const saved = await this.prisma.client.featureFlag.upsert({
      where: { key },
      update: data,
      create: { key, ...data },
    });
    this.cache.delete(key);
    RequestContext.setResourceId(saved.id);
    RequestContext.recordAfter(saved);
    return saved;
  }

  async remove(key: string): Promise<void> {
    const flag = await this.get(key);
    RequestContext.recordBefore(flag);
    RequestContext.setResourceId(flag.id);
    await this.prisma.client.featureFlag.delete({ where: { key } });
    this.cache.delete(key);
  }

  private async getFlag(key: string): Promise<FeatureFlag | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.flag;
    const flag = await this.prisma.client.featureFlag.findUnique({ where: { key } });
    this.cache.set(key, { flag, expiresAt: this.now() + CACHE_TTL_MS });
    return flag;
  }
}

function matchesRule(rule: FeatureFlagRuleDto, context: FlagContext): boolean {
  const subject = attributeValues(rule.attribute, context);
  if (subject.length === 0) return false;
  const values = Array.isArray(rule.value)
    ? rule.value
    : rule.value !== undefined
      ? [rule.value]
      : [];
  const normalised = new Set(values.map((value) => value.toLowerCase()));
  const hit = subject.some((value) => normalised.has(value.toLowerCase()));
  switch (rule.op) {
    case 'eq':
    case 'in':
      return hit;
    case 'not_in':
      return !hit;
    default:
      return false;
  }
}

function attributeValues(
  attribute: FeatureFlagRuleDto['attribute'],
  context: FlagContext,
): string[] {
  switch (attribute) {
    case 'userId':
      return context.userId ? [context.userId] : [];
    case 'realm':
      return context.realm ? [context.realm] : [];
    case 'countryCode':
      return context.countryCode ? [context.countryCode] : [];
    case 'emailDomain': {
      const domain = context.email?.split('@')[1];
      return domain ? [domain] : [];
    }
    case 'role':
      return context.roles ? [...context.roles] : [];
    default:
      return [];
  }
}
