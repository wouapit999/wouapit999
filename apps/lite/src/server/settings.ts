import { z } from 'zod';

import { writeAudit } from './audit';
import { type DbOrTx, db } from './db';
import { type ActionContext, actorUserId, assertPermission } from './rbac';

/**
 * Typed key/value settings stored in the `settings` table. Every key has a Zod schema and a
 * default, so the app works on an empty table and bad rows fall back to the default.
 */

const tierLimitSchema = z.object({
  /** USD cents. */
  perTransaction: z.string().regex(/^\d+$/),
  daily: z.string().regex(/^\d+$/),
  monthly: z.string().regex(/^\d+$/),
  international: z.boolean(),
});

export const SETTING_DEFINITIONS = {
  /** KYC tier limits in USD cents (strings, because JSON has no bigint). */
  'kyc.limits': {
    description: 'Transfer limits per KYC tier (USD cents)',
    schema: z.object({ TIER_0: tierLimitSchema, TIER_1: tierLimitSchema, TIER_2: tierLimitSchema }),
    defaultValue: {
      TIER_0: { perTransaction: '5000', daily: '10000', monthly: '30000', international: false },
      TIER_1: {
        perTransaction: '100000',
        daily: '250000',
        monthly: '1000000',
        international: true,
      },
      TIER_2: {
        perTransaction: '1000000',
        daily: '2500000',
        monthly: '10000000',
        international: true,
      },
    },
  },
  /** Vendor decisions of APPROVE are applied automatically; REVIEW always goes to the queue. */
  'kyc.autoApprove': {
    description: 'Automatically approve KYC cases the vendor clears',
    schema: z.boolean(),
    defaultValue: true,
  },
  'kyc.defaultVendor': {
    description: 'KYC vendor used when no country-specific rule applies',
    schema: z.enum(['veriff', 'sumsub', 'smile_identity']),
    defaultValue: 'smile_identity',
  },
  'aml.holdScore': {
    description: 'Aggregate AML score at or above which a transfer is held',
    schema: z.number().int().min(1).max(1000),
    defaultValue: 60,
  },
  'aml.matchThreshold': {
    description: 'Fuzzy name-match threshold (0–100) for sanctions/PEP screening',
    schema: z.number().int().min(50).max(100),
    defaultValue: 88,
  },
  'fx.quoteTtlMinutes': {
    description: 'Validity of a locked FX quote, in minutes',
    schema: z.number().int().min(1).max(120),
    defaultValue: 15,
  },
  'platform.maintenance': {
    description: 'Maintenance banner shown on the status page',
    schema: z.object({ enabled: z.boolean(), message: z.string().max(500) }),
    defaultValue: { enabled: false, message: '' },
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export async function getSetting<K extends SettingKey>(
  key: K,
  client: DbOrTx = db,
): Promise<SettingValue<K>> {
  const definition = SETTING_DEFINITIONS[key];
  const row = await client.setting.findUnique({ where: { key } });
  if (!row) return definition.defaultValue as SettingValue<K>;
  const parsed = definition.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : definition.defaultValue) as SettingValue<K>;
}

/** All settings with their current value, default and description (admin settings page). */
export async function listSettings(ctx: ActionContext) {
  assertPermission(ctx, 'admin:access');
  const rows = await db.setting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return SETTING_KEYS.map((key) => {
    const definition = SETTING_DEFINITIONS[key];
    const row = byKey.get(key);
    const parsed = row ? definition.schema.safeParse(row.value) : undefined;
    return {
      key,
      description: definition.description,
      value: parsed?.success ? parsed.data : definition.defaultValue,
      defaultValue: definition.defaultValue,
      isDefault: !parsed?.success,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** Validates and stores a setting. Requires `settings:write`; audited with before/after. */
export async function setSetting<K extends SettingKey>(
  ctx: ActionContext,
  key: K,
  value: unknown,
): Promise<SettingValue<K>> {
  assertPermission(ctx, 'settings:write');
  const definition = SETTING_DEFINITIONS[key];
  const parsed = definition.schema.parse(value) as SettingValue<K>;
  const before = await getSetting(key);
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key },
      create: {
        key,
        value: parsed,
        description: definition.description,
        updatedById: actorUserId(ctx),
      },
      update: { value: parsed, updatedById: actorUserId(ctx) },
    });
    await writeAudit(tx, ctx, {
      action: 'setting.update',
      resourceType: 'setting',
      resourceId: key,
      before,
      after: parsed,
    });
  });
  return parsed;
}
