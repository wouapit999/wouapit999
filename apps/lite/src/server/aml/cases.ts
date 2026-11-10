import { z } from 'zod';

import type { AmlAlertStatus, AmlCaseStatus, RiskLevel } from '@/generated/prisma/enums';

import { writeAudit } from '../audit';
import { randomCode } from '../crypto';
import { type Prisma, type Tx, db, withTransaction } from '../db';
import { AppError, isUniqueViolation } from '../errors';
import { type ActionContext, actorUserId, assertPermission } from '../rbac';
import {
  finishHeldTransfer,
  rejectHeldTransferTx,
  releaseHeldTransferTx,
} from '../transfers/engine';
import {
  AML_RULE_PARAM_SCHEMAS,
  assessUserRisk,
  newCaseReference,
  serializeRuleParams,
} from './engine';
import { normalizeName } from './names';

/**
 * Compliance workflow (phase 8): alerts → cases → notes → release / reject → SAR
 * (draft → filed with reference), plus administration of rules and the demo screening list.
 */

const actorName = (ctx: ActionContext): string => ctx.actor.label;

const paging = (filter: { page?: number; pageSize?: number }) => {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function listAlerts(
  ctx: ActionContext,
  filter: {
    status?: AmlAlertStatus;
    severity?: RiskLevel;
    userId?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  assertPermission(ctx, 'aml:read');
  const where: Prisma.AmlAlertWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.severity ? { severity: filter.severity } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const { page, pageSize, skip, take } = paging(filter);
  const [items, total] = await Promise.all([
    db.amlAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        transfer: {
          select: {
            id: true,
            reference: true,
            status: true,
            sendAmount: true,
            sourceCurrency: true,
            sendAmountUsd: true,
          },
        },
        case: { select: { id: true, reference: true, status: true } },
      },
    }),
    db.amlAlert.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** Closes an alert as a false positive. Requires `aml:write`. */
export async function dismissAlert(ctx: ActionContext, alertId: string, note: string) {
  assertPermission(ctx, 'aml:write');
  const reason = z
    .string()
    .trim()
    .min(3, 'Explain why the alert is dismissed')
    .max(1000)
    .parse(note);
  return db.$transaction(async (tx) => {
    const alert = await tx.amlAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new AppError('NOT_FOUND', 'Alert not found');
    if (alert.status !== 'OPEN')
      throw new AppError('INVALID_STATE', 'Only open alerts can be dismissed');
    const updated = await tx.amlAlert.update({
      where: { id: alertId },
      data: { status: 'DISMISSED', resolvedById: actorUserId(ctx), resolvedAt: new Date() },
    });
    await writeAudit(tx, ctx, {
      action: 'aml.alert.dismiss',
      resourceType: 'aml_alert',
      resourceId: alertId,
      before: { status: alert.status },
      after: { status: 'DISMISSED', note: reason },
    });
    return updated;
  });
}

/** Opens a case from an open alert (and attaches the user's other open alerts on that transfer). */
export async function escalateAlert(ctx: ActionContext, alertId: string, summary?: string) {
  assertPermission(ctx, 'aml:write');
  return db.$transaction(async (tx) => {
    const alert = await tx.amlAlert.findUnique({
      where: { id: alertId },
      include: { transfer: { select: { reference: true } } },
    });
    if (!alert) throw new AppError('NOT_FOUND', 'Alert not found');
    if (alert.status !== 'OPEN')
      throw new AppError('INVALID_STATE', 'Only open alerts can be escalated');
    const amlCase = await tx.amlCase.create({
      data: {
        reference: newCaseReference(),
        subjectUserId: alert.userId,
        transferId: alert.transferId,
        priority: alert.severity,
        summary:
          summary?.trim() ||
          `Escalated alert ${alert.ruleCode}${alert.transfer ? ` on ${alert.transfer.reference}` : ''}`,
        openedById: actorUserId(ctx),
      },
    });
    await tx.amlAlert.updateMany({
      where: {
        status: 'OPEN',
        OR: [{ id: alertId }, ...(alert.transferId ? [{ transferId: alert.transferId }] : [])],
      },
      data: { status: 'ESCALATED', caseId: amlCase.id },
    });
    await writeAudit(tx, ctx, {
      action: 'aml.alert.escalate',
      resourceType: 'aml_case',
      resourceId: amlCase.id,
      after: { reference: amlCase.reference, alertId },
    });
    return amlCase;
  });
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export async function listCases(
  ctx: ActionContext,
  filter: { status?: AmlCaseStatus; assignedToId?: string; page?: number; pageSize?: number } = {},
) {
  assertPermission(ctx, 'aml:read');
  const where: Prisma.AmlCaseWhereInput = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.assignedToId ? { assignedToId: filter.assignedToId } : {}),
  };
  const { page, pageSize, skip, take } = paging(filter);
  const [items, total] = await Promise.all([
    db.amlCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        subject: { select: { id: true, fullName: true, email: true, riskLevel: true } },
        transfer: {
          select: {
            id: true,
            reference: true,
            status: true,
            sendAmount: true,
            sourceCurrency: true,
            sendAmountUsd: true,
          },
        },
        _count: { select: { alerts: true, notes: true, sars: true } },
      },
    }),
    db.amlCase.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getCase(ctx: ActionContext, caseId: string) {
  assertPermission(ctx, 'aml:read');
  const amlCase = await db.amlCase.findUnique({
    where: { id: caseId },
    include: {
      subject: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          countryCode: true,
          kycTier: true,
          kycStatus: true,
          riskLevel: true,
          riskScore: true,
          riskFactors: true,
          pepMatch: true,
          sanctionsMatch: true,
          createdAt: true,
        },
      },
      transfer: true,
      alerts: { orderBy: { createdAt: 'asc' } },
      notes: { orderBy: { createdAt: 'asc' } },
      sars: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!amlCase) throw new AppError('NOT_FOUND', 'Case not found');
  return amlCase;
}

const OPEN_STATUSES: readonly AmlCaseStatus[] = ['OPEN', 'UNDER_REVIEW'];

async function lockOpenCase(tx: Tx, caseId: string) {
  await tx.$queryRaw`SELECT id FROM aml_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
  const amlCase = await tx.amlCase.findUnique({ where: { id: caseId } });
  if (!amlCase) throw new AppError('NOT_FOUND', 'Case not found');
  if (!OPEN_STATUSES.includes(amlCase.status))
    throw new AppError('INVALID_STATE', 'This case is already closed');
  return amlCase;
}

const noteSchema = z.string().trim().min(3, 'Write a note').max(4000);

/** Adds an investigator note; the first note moves an OPEN case to UNDER_REVIEW. */
export async function addCaseNote(ctx: ActionContext, caseId: string, body: string) {
  assertPermission(ctx, 'aml:write');
  const text = noteSchema.parse(body);
  return db.$transaction(async (tx) => {
    const amlCase = await tx.amlCase.findUnique({ where: { id: caseId } });
    if (!amlCase) throw new AppError('NOT_FOUND', 'Case not found');
    const note = await tx.amlCaseNote.create({
      data: { caseId, authorId: actorUserId(ctx), authorName: actorName(ctx), body: text },
    });
    if (amlCase.status === 'OPEN') {
      await tx.amlCase.update({ where: { id: caseId }, data: { status: 'UNDER_REVIEW' } });
    }
    await writeAudit(tx, ctx, {
      action: 'aml.case.note',
      resourceType: 'aml_case',
      resourceId: caseId,
      metadata: { noteId: note.id },
    });
    return note;
  });
}

/** Assigns a case to a staff member (or to the actor when `assigneeId` is omitted). */
export async function assignCase(ctx: ActionContext, caseId: string, assigneeId?: string) {
  assertPermission(ctx, 'aml:write');
  const target = assigneeId ?? actorUserId(ctx);
  if (!target) throw new AppError('VALIDATION', 'Choose an assignee');
  const assignee = await db.user.findUnique({
    where: { id: target },
    select: { role: true, status: true },
  });
  if (assignee?.status !== 'ACTIVE' || !['COMPLIANCE', 'ADMIN'].includes(assignee.role)) {
    throw new AppError('VALIDATION', 'Cases can only be assigned to compliance staff');
  }
  return db.$transaction(async (tx) => {
    const amlCase = await lockOpenCase(tx, caseId);
    const updated = await tx.amlCase.update({
      where: { id: caseId },
      data: { assignedToId: target, status: 'UNDER_REVIEW' },
    });
    await writeAudit(tx, ctx, {
      action: 'aml.case.assign',
      resourceType: 'aml_case',
      resourceId: caseId,
      before: { assignedToId: amlCase.assignedToId },
      after: { assignedToId: target },
    });
    return updated;
  });
}

async function closeCase(
  ctx: ActionContext,
  caseId: string,
  decision: 'RELEASED' | 'REJECTED' | 'CLOSED',
  note: string,
) {
  assertPermission(ctx, 'aml:write');
  const resolution = z.string().trim().min(5, 'Explain the decision').max(2000).parse(note);
  const now = new Date();
  const actorId = actorUserId(ctx);
  const result = await withTransaction(async (tx) => {
    const amlCase = await lockOpenCase(tx, caseId);
    let transfer = null;
    if (amlCase.transferId) {
      const linked = await tx.transfer.findUnique({
        where: { id: amlCase.transferId },
        select: { status: true },
      });
      if (linked?.status === 'ON_HOLD') {
        if (decision === 'CLOSED') {
          throw new AppError(
            'INVALID_STATE',
            'Release or reject the held transfer to close this case',
          );
        }
        transfer =
          decision === 'RELEASED'
            ? await releaseHeldTransferTx(tx, amlCase.transferId, {
                now,
                actorId,
                note: resolution,
              })
            : await rejectHeldTransferTx(tx, amlCase.transferId, {
                now,
                actorId,
                reason: resolution,
              });
      }
    }
    const updated = await tx.amlCase.update({
      where: { id: caseId },
      data: { status: decision, resolution, closedById: actorId, closedAt: now },
    });
    await tx.amlAlert.updateMany({
      where: { caseId, status: { in: ['OPEN', 'ESCALATED'] } },
      data: { status: 'RESOLVED', resolvedById: actorId, resolvedAt: now },
    });
    await tx.amlCaseNote.create({
      data: {
        caseId,
        authorId: actorId,
        authorName: actorName(ctx),
        body: `${decision === 'RELEASED' ? 'Released' : decision === 'REJECTED' ? 'Rejected' : 'Closed'}: ${resolution}`,
      },
    });
    await writeAudit(tx, ctx, {
      action: `aml.case.${decision.toLowerCase()}`,
      resourceType: 'aml_case',
      resourceId: caseId,
      before: { status: amlCase.status },
      after: { status: decision, resolution, transferStatus: transfer?.status ?? null },
    });
    return { amlCase: updated, transfer, subjectUserId: amlCase.subjectUserId };
  });
  const transfer = result.transfer ? await finishHeldTransfer(result.transfer) : null;
  if (result.subjectUserId) await assessUserRisk(db, result.subjectUserId).catch(() => undefined);
  return { amlCase: result.amlCase, transfer };
}

/** Clears the case and completes the held transfer. Requires `aml:write`. */
export const releaseCase = (ctx: ActionContext, caseId: string, note: string) =>
  closeCase(ctx, caseId, 'RELEASED', note);

/** Confirms the suspicion: rejects the held transfer and refunds the sender. */
export const rejectCase = (ctx: ActionContext, caseId: string, note: string) =>
  closeCase(ctx, caseId, 'REJECTED', note);

/** Closes a case that has no held transfer (e.g. opened from an escalated alert). */
export const closeCaseWithoutAction = (ctx: ActionContext, caseId: string, note: string) =>
  closeCase(ctx, caseId, 'CLOSED', note);

// ---------------------------------------------------------------------------
// Suspicious activity reports
// ---------------------------------------------------------------------------

const narrativeSchema = z
  .string()
  .trim()
  .min(20, 'Describe the suspicion (at least 20 characters)')
  .max(10_000);

export async function listSars(ctx: ActionContext, filter: { status?: 'DRAFT' | 'FILED' } = {}) {
  assertPermission(ctx, 'aml:read');
  return db.sarReport.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: { createdAt: 'desc' },
    include: { case: { select: { id: true, reference: true, status: true } } },
  });
}

/** Starts a SAR draft on a case. Requires `sar:write`. */
export async function createSarDraft(ctx: ActionContext, caseId: string, narrative: string) {
  assertPermission(ctx, 'sar:write');
  const text = narrativeSchema.parse(narrative);
  return db.$transaction(async (tx) => {
    const amlCase = await tx.amlCase.findUnique({ where: { id: caseId } });
    if (!amlCase) throw new AppError('NOT_FOUND', 'Case not found');
    const sar = await tx.sarReport.create({
      data: { caseId, narrative: text, createdById: actorUserId(ctx) },
    });
    await writeAudit(tx, ctx, {
      action: 'sar.draft.create',
      resourceType: 'sar_report',
      resourceId: sar.id,
      after: { caseId, status: 'DRAFT' },
    });
    return sar;
  });
}

export async function updateSarDraft(ctx: ActionContext, sarId: string, narrative: string) {
  assertPermission(ctx, 'sar:write');
  const text = narrativeSchema.parse(narrative);
  return db.$transaction(async (tx) => {
    const sar = await tx.sarReport.findUnique({ where: { id: sarId } });
    if (!sar) throw new AppError('NOT_FOUND', 'Report not found');
    if (sar.status !== 'DRAFT')
      throw new AppError('INVALID_STATE', 'A filed report cannot be edited');
    const updated = await tx.sarReport.update({ where: { id: sarId }, data: { narrative: text } });
    await writeAudit(tx, ctx, {
      action: 'sar.draft.update',
      resourceType: 'sar_report',
      resourceId: sarId,
    });
    return updated;
  });
}

/**
 * Files a SAR: DRAFT → FILED with a filing reference. Lite records the filing; it does not
 * transmit anything to a regulator (goAML integration is a roadmap item).
 */
export async function fileSar(
  ctx: ActionContext,
  sarId: string,
  input: { regulator: string; reference?: string },
) {
  assertPermission(ctx, 'sar:write');
  const data = z
    .object({
      regulator: z.string().trim().min(2, 'Name the authority').max(120),
      reference: z.string().trim().min(3).max(60).optional(),
    })
    .parse(input);
  const now = new Date();
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sar_reports WHERE id = ${sarId}::uuid FOR UPDATE`;
      const sar = await tx.sarReport.findUnique({ where: { id: sarId } });
      if (!sar) throw new AppError('NOT_FOUND', 'Report not found');
      if (sar.status !== 'DRAFT')
        throw new AppError('INVALID_STATE', 'This report has already been filed');
      const reference = data.reference ?? `SAR-${now.getUTCFullYear()}-${randomCode(8)}`;
      const updated = await tx.sarReport.update({
        where: { id: sarId },
        data: {
          status: 'FILED',
          reference,
          regulator: data.regulator,
          filedById: actorUserId(ctx),
          filedAt: now,
        },
      });
      await writeAudit(tx, ctx, {
        action: 'sar.file',
        resourceType: 'sar_report',
        resourceId: sarId,
        before: { status: 'DRAFT' },
        after: { status: 'FILED', reference, regulator: data.regulator },
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError('CONFLICT', 'This filing reference is already used');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function listAmlRules(ctx: ActionContext) {
  assertPermission(ctx, 'aml:read');
  return db.amlRule.findMany({ orderBy: { code: 'asc' } });
}

export const amlRuleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
  action: z.enum(['FLAG', 'HOLD']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  /** Validated against the schema of the rule's type. */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Tunes a rule (toggle, score, action, parameters). Requires `aml:write`; audited. */
export async function updateAmlRule(
  ctx: ActionContext,
  ruleId: string,
  input: z.infer<typeof amlRuleUpdateSchema>,
) {
  assertPermission(ctx, 'aml:write');
  const data = amlRuleUpdateSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.amlRule.findUnique({ where: { id: ruleId } });
    if (!before) throw new AppError('NOT_FOUND', 'Rule not found');
    let params: Prisma.InputJsonValue | undefined;
    if (data.params) {
      const parsed = AML_RULE_PARAM_SCHEMAS[before.type].safeParse(data.params);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION',
          `Invalid parameters for ${before.type}: ${parsed.error.issues[0]?.message ?? 'check the values'}`,
        );
      }
      params = serializeRuleParams(parsed.data);
    }
    const after = await tx.amlRule.update({
      where: { id: ruleId },
      data: {
        ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
        ...(data.score === undefined ? {} : { score: data.score }),
        ...(data.action === undefined ? {} : { action: data.action }),
        ...(data.severity === undefined ? {} : { severity: data.severity }),
        ...(params === undefined ? {} : { params }),
      },
    });
    await writeAudit(tx, ctx, {
      action: 'aml.rule.update',
      resourceType: 'aml_rule',
      resourceId: ruleId,
      before: {
        enabled: before.enabled,
        score: before.score,
        action: before.action,
        severity: before.severity,
        params: before.params,
      },
      after: {
        enabled: after.enabled,
        score: after.score,
        action: after.action,
        severity: after.severity,
        params: after.params,
      },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Screening list (demo data)
// ---------------------------------------------------------------------------

export async function listSanctionsEntries(
  ctx: ActionContext,
  filter: { type?: 'SANCTION' | 'PEP'; search?: string } = {},
) {
  assertPermission(ctx, 'aml:read');
  return db.sanctionsEntry.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.search ? { normalizedName: { contains: normalizeName(filter.search) } } : {}),
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
}

export const sanctionsEntrySchema = z.object({
  listName: z.string().trim().min(2).max(80),
  type: z.enum(['SANCTION', 'PEP']),
  name: z.string().trim().min(3).max(160),
  aliases: z.array(z.string().trim().min(3).max(160)).max(10).default([]),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Adds an entry to the screening list. Requires `sanctions:write`. */
export async function addSanctionsEntry(
  ctx: ActionContext,
  input: z.input<typeof sanctionsEntrySchema>,
) {
  assertPermission(ctx, 'sanctions:write');
  const data = sanctionsEntrySchema.parse(input);
  return db.$transaction(async (tx) => {
    const entry = await tx.sanctionsEntry.create({
      data: {
        code: `manual-${randomCode(10).toLowerCase()}`,
        listName: data.listName,
        type: data.type,
        name: data.name,
        normalizedName: normalizeName(data.name),
        aliases: data.aliases,
        countryCode: data.countryCode ?? null,
        notes: data.notes ?? null,
      },
    });
    await writeAudit(tx, ctx, {
      action: 'sanctions.entry.add',
      resourceType: 'sanctions_entry',
      resourceId: entry.id,
      after: { listName: entry.listName, type: entry.type, name: entry.name },
    });
    return entry;
  });
}

export async function setSanctionsEntryActive(
  ctx: ActionContext,
  entryId: string,
  active: boolean,
) {
  assertPermission(ctx, 'sanctions:write');
  return db.$transaction(async (tx) => {
    const before = await tx.sanctionsEntry.findUnique({ where: { id: entryId } });
    if (!before) throw new AppError('NOT_FOUND', 'Entry not found');
    const after = await tx.sanctionsEntry.update({ where: { id: entryId }, data: { active } });
    await writeAudit(tx, ctx, {
      action: active ? 'sanctions.entry.activate' : 'sanctions.entry.deactivate',
      resourceType: 'sanctions_entry',
      resourceId: entryId,
      before: { active: before.active },
      after: { active },
    });
    return after;
  });
}
