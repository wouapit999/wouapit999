'use server';

import { z } from 'zod';

import { checkbox } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import {
  addCaseNote,
  addSanctionsEntry,
  assignCase,
  closeCaseWithoutAction,
  createSarDraft,
  dismissAlert,
  escalateAlert,
  fileSar,
  rejectCase,
  releaseCase,
  setSanctionsEntryActive,
  updateAmlRule,
  updateSarDraft,
} from '@/server/aml';
import { AppError } from '@/server/errors';
import { parseMoney } from '@/server/money';

/**
 * Compliance workflow actions. Every one is permission-checked here and again in the service,
 * which also writes the audit row in the same transaction as the change.
 */

const LIST = '/admin/compliance';
const casePaths = (caseId: string): string[] => [
  `${LIST}/cases/${caseId}`,
  LIST,
  '/admin/transfers',
  '/admin',
];

export const dismissAlertAction = createAction({
  schema: z.object({
    alertId: z.uuid(),
    note: z.string().trim().min(3, 'Explain why the alert is dismissed').max(1000),
  }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    const alert = await dismissAlert(ctx, input.alertId, input.note);
    return { id: alert.id };
  },
  successMessage: 'Alert dismissed',
  revalidate: [LIST],
});

export const escalateAlertAction = createAction({
  schema: z.object({ alertId: z.uuid(), summary: z.string().trim().max(300).optional() }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    const amlCase = await escalateAlert(ctx, input.alertId, input.summary);
    return { id: amlCase.id };
  },
  revalidate: [LIST],
  redirectTo: (result) => `${LIST}/cases/${result.id}`,
});

export const addCaseNoteAction = createAction({
  schema: z.object({ caseId: z.uuid(), body: z.string().trim().min(3, 'Write a note').max(4000) }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    await addCaseNote(ctx, input.caseId, input.body);
    return { id: input.caseId };
  },
  successMessage: 'Note added',
  revalidate: (result) => casePaths(result.id),
});

export const assignCaseToMeAction = createAction({
  schema: z.object({ caseId: z.uuid() }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    await assignCase(ctx, input.caseId);
    return { id: input.caseId };
  },
  successMessage: 'Case assigned to you',
  revalidate: (result) => casePaths(result.id),
});

/** Release (complete the held transfer), reject (refund it) or close a case without a hold. */
export const decideCaseAction = createAction({
  schema: z.object({
    caseId: z.uuid(),
    decision: z.enum(['RELEASE', 'REJECT', 'CLOSE']),
    note: z.string().trim().min(5, 'Explain the decision (at least 5 characters)').max(2000),
  }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    const decide =
      input.decision === 'RELEASE'
        ? releaseCase
        : input.decision === 'REJECT'
          ? rejectCase
          : closeCaseWithoutAction;
    const { amlCase, transfer } = await decide(ctx, input.caseId, input.note);
    return {
      id: amlCase.id,
      decision: input.decision,
      transferStatus: transfer?.status ?? null,
    };
  },
  revalidate: (result) => casePaths(result.id),
  // The decision forms disappear once the case is closed: confirm on the reloaded page.
  redirectTo: (result) =>
    `${LIST}/cases/${result.id}?notice=case-${
      result.decision === 'RELEASE'
        ? 'released'
        : result.decision === 'REJECT'
          ? 'rejected'
          : 'closed'
    }`,
});

const narrative = z
  .string()
  .trim()
  .min(20, 'Describe the suspicion (at least 20 characters)')
  .max(10_000);

export const createSarDraftAction = createAction({
  schema: z.object({ caseId: z.uuid(), narrative }),
  permission: 'sar:write',
  handler: async (input, ctx) => {
    await createSarDraft(ctx, input.caseId, input.narrative);
    return { id: input.caseId };
  },
  revalidate: (result) => casePaths(result.id),
  redirectTo: (result) => `${LIST}/cases/${result.id}?notice=sar-drafted`,
});

export const updateSarDraftAction = createAction({
  schema: z.object({ sarId: z.uuid(), caseId: z.uuid(), narrative }),
  permission: 'sar:write',
  handler: async (input, ctx) => {
    await updateSarDraft(ctx, input.sarId, input.narrative);
    return { id: input.caseId };
  },
  successMessage: 'Draft updated',
  revalidate: (result) => casePaths(result.id),
});

export const fileSarAction = createAction({
  schema: z.object({
    sarId: z.uuid(),
    caseId: z.uuid(),
    regulator: z.string().trim().min(2, 'Name the authority').max(120),
    reference: z.string().trim().min(3).max(60).optional(),
  }),
  permission: 'sar:write',
  handler: async (input, ctx) => {
    const sar = await fileSar(ctx, input.sarId, {
      regulator: input.regulator,
      reference: input.reference,
    });
    return { id: input.caseId, reference: sar.reference };
  },
  revalidate: (result) => casePaths(result.id),
  redirectTo: (result) => `${LIST}/cases/${result.id}?notice=sar-filed`,
});

export const toggleAmlRuleAction = createAction({
  schema: z.object({ ruleId: z.uuid(), enabled: z.enum(['true', 'false']) }),
  permission: 'aml:write',
  handler: async (input, ctx) => {
    const rule = await updateAmlRule(ctx, input.ruleId, { enabled: input.enabled === 'true' });
    return { code: rule.code, enabled: rule.enabled };
  },
  successMessage: (result) => `${result.code} ${result.enabled ? 'enabled' : 'disabled'}`,
  revalidate: [LIST],
});

/**
 * Rule parameters arrive as `param.<name>` fields. USD thresholds are typed in dollars and
 * converted to cents with `parseMoney`; counts and windows are whole numbers; the screening
 * list type is passed through. The service validates the result against the rule type's schema.
 */
function readRuleParams(formData: FormData): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('param.') || typeof raw !== 'string') continue;
    const name = key.slice('param.'.length);
    const value = raw.trim();
    if (value === '') throw new AppError('VALIDATION', `Enter a value for ${name}`);
    if (name.endsWith('Usd')) {
      params[name] = parseMoney(value, 'USD').toString();
    } else if (name === 'listType') {
      params[name] = value;
    } else {
      if (!/^\d{1,9}$/.test(value)) {
        throw new AppError('VALIDATION', `${name} must be a whole number`);
      }
      params[name] = Number.parseInt(value, 10);
    }
  }
  return params;
}

export const updateAmlRuleAction = createAction({
  schema: z.object({
    ruleId: z.uuid(),
    enabled: checkbox,
    score: z.coerce.number('Enter a score').int().min(0).max(100),
    action: z.enum(['FLAG', 'HOLD']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  }),
  permission: 'aml:write',
  handler: async (input, ctx, formData) => {
    const params = readRuleParams(formData);
    const rule = await updateAmlRule(ctx, input.ruleId, {
      enabled: input.enabled,
      score: input.score,
      action: input.action,
      severity: input.severity,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
    return { code: rule.code };
  },
  revalidate: [LIST],
  redirectTo: (result) => `${LIST}?tab=rules&saved=${result.code}`,
});

export const addSanctionsEntryAction = createAction({
  schema: z.object({
    listName: z.string().trim().min(2, 'Name the list').max(80),
    type: z.enum(['SANCTION', 'PEP']),
    name: z.string().trim().min(3, 'Enter the full name').max(160),
    aliases: z
      .string()
      .max(2000)
      .optional()
      .transform((text) =>
        (text ?? '')
          .split(/[\n;]+/)
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0),
      ),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Two-letter country code')
      .optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  permission: 'sanctions:write',
  handler: async (input, ctx) => {
    const entry = await addSanctionsEntry(ctx, input);
    return { id: entry.id, name: entry.name };
  },
  successMessage: (result) => `${result.name} added to the screening list`,
  revalidate: [LIST],
});

export const setSanctionsEntryActiveAction = createAction({
  schema: z.object({ entryId: z.uuid(), active: z.enum(['true', 'false']) }),
  permission: 'sanctions:write',
  handler: async (input, ctx) => {
    const entry = await setSanctionsEntryActive(ctx, input.entryId, input.active === 'true');
    return { id: entry.id, active: entry.active };
  },
  successMessage: (result) => (result.active ? 'Entry activated' : 'Entry deactivated'),
  revalidate: [LIST],
});
