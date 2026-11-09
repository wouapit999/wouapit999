import { z } from 'zod';

import { FEATURE_FLAG_KEY_PATTERN, SETTING_KEY_PATTERN } from '../constants/feature-flags.js';
import { USER_REALMS } from '../constants/realms.js';
import { userRealmSchema } from './auth.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';

export const featureFlagKeySchema = z
  .string()
  .trim()
  .regex(FEATURE_FLAG_KEY_PATTERN, {
    error: 'Flag keys look like area.feature or area.feature.variant',
  })
  .max(100);

export const upsertFeatureFlagSchema = z
  .object({
    key: featureFlagKeySchema,
    enabled: z.boolean(),
    description: z.string().trim().max(500).optional(),
    /** Percentage of eligible users who see the flag on (bucketed by a stable user hash). */
    rolloutPercentage: z.number().int().min(0).max(100).default(100),
    /** Realms where the flag applies; defaults to both. */
    realms: z
      .array(userRealmSchema)
      .min(1)
      .default([...USER_REALMS]),
    /** Explicit allow-list of user ids that always get the flag on. */
    allowUserIds: z.array(uuidSchema).max(500).default([]),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict()
  .refine((value) => value.realms.length === new Set(value.realms).size, {
    error: 'Realms must be unique',
    path: ['realms'],
  });
export type UpsertFeatureFlagInput = z.input<typeof upsertFeatureFlagSchema>;
export type UpsertFeatureFlagDto = z.infer<typeof upsertFeatureFlagSchema>;

export const featureFlagSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  enabled: z.boolean(),
  description: z.string().nullable(),
  rolloutPercentage: z.number().int().min(0).max(100),
  realms: z.array(userRealmSchema),
  allowUserIds: z.array(uuidSchema),
  metadata: z.record(z.string(), z.json()).nullable(),
  updatedBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/** Flat evaluation map handed to the portals at boot: `{ "auth.mfa.totp": true, ... }`. */
export const featureFlagEvaluationSchema = z.record(featureFlagKeySchema, z.boolean());
export type FeatureFlagEvaluation = z.infer<typeof featureFlagEvaluationSchema>;

export const settingKeySchema = z
  .string()
  .trim()
  .regex(SETTING_KEY_PATTERN, { error: 'Setting keys look like area.name' })
  .max(100);

/** Settings hold any JSON value; secret settings are encrypted at rest and redacted on read. */
export const settingValueSchema = z.json();
export type SettingValue = z.infer<typeof settingValueSchema>;

export const upsertSettingSchema = z
  .object({
    key: settingKeySchema,
    value: settingValueSchema,
    description: z.string().trim().max(500).optional(),
    isSecret: z.boolean().default(false),
  })
  .strict();
export type UpsertSettingInput = z.input<typeof upsertSettingSchema>;
export type UpsertSettingDto = z.infer<typeof upsertSettingSchema>;

export const settingSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  /** `null` when `isSecret` is true: secrets are never returned to clients. */
  value: settingValueSchema.nullable(),
  description: z.string().nullable(),
  isSecret: z.boolean(),
  updatedBy: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Setting = z.infer<typeof settingSchema>;
