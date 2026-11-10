import { z } from 'zod';

import type { AmlAction, AmlRuleType, RiskLevel, TransferType } from '@/generated/prisma/enums';

import { randomCode } from '../crypto';
import { type DbOrTx, type Prisma, type Tx, db } from '../db';
import { notifyRoles } from '../notifications';
import { toBigInt } from '../money';
import { getSetting } from '../settings';
import { nameSimilarity, normalizeName } from './names';

/** How far past a request's start its history window stays open (see `velocity`). */
const QUEUE_SLACK_MS = 60_000;

/**
 * AML / fraud rule engine (phase 8). Evaluated inside the transfer transaction, BEFORE any
 * debit, with the sender's wallet account locked so velocity counts are consistent.
 *
 * The screening list is seeded DEMO data with fictional names — not a real sanctions/PEP list.
 */

// ---------------------------------------------------------------------------
// Rule parameters
// ---------------------------------------------------------------------------

const usdCents = z.coerce.bigint().nonnegative();

export const AML_RULE_PARAM_SCHEMAS = {
  /** Single transfer at or above a USD value. */
  AMOUNT_THRESHOLD: z.object({ thresholdUsd: usdCents }),
  /** More than `maxCount` outgoing transfers within the window (including this one). */
  VELOCITY_COUNT: z.object({
    windowHours: z.number().int().min(1).max(720),
    maxCount: z.number().int().min(1),
  }),
  /** Outgoing value within the window (including this one) above a USD value. */
  VELOCITY_VALUE: z.object({
    windowHours: z.number().int().min(1).max(720),
    maxValueUsd: usdCents,
  }),
  /**
   * Structuring: at least `minCount` transfers (including this one) within the window, each
   * between `bandPercent`% and 100% of `thresholdUsd` — i.e. kept just under a reporting line.
   */
  STRUCTURING: z.object({
    windowHours: z.number().int().min(1).max(720),
    thresholdUsd: usdCents,
    bandPercent: z.number().int().min(50).max(99),
    minCount: z.number().int().min(2),
  }),
  /** Account younger than `accountAgeDays` sending at or above a USD value. */
  NEW_ACCOUNT_HIGH_VALUE: z.object({
    accountAgeDays: z.number().int().min(1).max(365),
    thresholdUsd: usdCents,
  }),
  /** Source or target country rated HIGH risk, at or above a USD value. */
  HIGH_RISK_CORRIDOR: z.object({ thresholdUsd: usdCents }),
  /** Sender or recipient name matches an active entry of the given list type. */
  SANCTIONS_MATCH: z.object({ listType: z.enum(['SANCTION', 'PEP']) }),
} as const satisfies Record<AmlRuleType, z.ZodType>;

export type AmlRuleParams<T extends AmlRuleType> = z.infer<(typeof AML_RULE_PARAM_SCHEMAS)[T]>;

/** JSON-safe form of rule params (bigint → string) for storage. */
export function serializeRuleParams(params: Record<string, unknown>): Prisma.InputJsonValue {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value,
    ]),
  ) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Name screening
// ---------------------------------------------------------------------------

export interface ScreeningHit {
  readonly entryId: string;
  readonly listName: string;
  readonly type: 'SANCTION' | 'PEP';
  readonly matchedName: string;
  /** 0–100. */
  readonly score: number;
}

/** Screens one name against the active list. Returns hits at or above the match threshold. */
export async function screenName(
  client: DbOrTx,
  name: string,
  options: { threshold?: number; listType?: 'SANCTION' | 'PEP' } = {},
): Promise<ScreeningHit[]> {
  const normalized = normalizeName(name);
  if (normalized.length < 3) return [];
  const threshold = options.threshold ?? (await getSetting('aml.matchThreshold', client));
  const entries = await client.sanctionsEntry.findMany({
    where: { active: true, ...(options.listType ? { type: options.listType } : {}) },
    select: { id: true, listName: true, type: true, name: true, aliases: true },
  });
  const hits: ScreeningHit[] = [];
  for (const entry of entries) {
    let best = { score: 0, name: entry.name };
    for (const candidate of [entry.name, ...entry.aliases]) {
      const score = nameSimilarity(normalized, candidate);
      if (score > best.score) best = { score, name: candidate };
    }
    if (best.score >= threshold) {
      hits.push({
        entryId: entry.id,
        listName: entry.listName,
        type: entry.type,
        matchedName: best.name,
        score: best.score,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Transfer evaluation
// ---------------------------------------------------------------------------

export interface TransferScreeningInput {
  /** Null for partner-initiated (API) transfers. */
  readonly senderUserId: string | null;
  readonly senderName: string;
  /** When the sender's account was created (null → rule skipped). */
  readonly senderCreatedAt: Date | null;
  readonly recipientName: string;
  readonly sourceCountry: string;
  readonly targetCountry: string;
  readonly type: TransferType;
  /** USD cents at mid rate. */
  readonly amountUsd: bigint;
  readonly now: Date;
}

export interface RuleHit {
  readonly ruleCode: string;
  readonly ruleType: AmlRuleType;
  readonly severity: RiskLevel;
  readonly score: number;
  readonly action: AmlAction;
  readonly message: string;
  readonly details: Record<string, string | number | boolean>;
}

export interface ScreeningResult {
  readonly decision: 'CLEAR' | 'FLAG' | 'HOLD';
  /** Sum of the scores of all hits. */
  readonly score: number;
  readonly hits: readonly RuleHit[];
}

interface VelocityRow {
  count: bigint;
  value: bigint | null;
}

const usdText = (cents: bigint): string => `$${(cents / 100n).toString()}`;

/**
 * Runs every enabled rule against a prospective transfer. HOLD when a hit's rule says HOLD or
 * the total score reaches `aml.holdScore`; FLAG when there are hits but none holds; else CLEAR.
 */
export async function evaluateTransfer(
  client: DbOrTx,
  input: TransferScreeningInput,
): Promise<ScreeningResult> {
  const [rules, holdScore, threshold] = await Promise.all([
    client.amlRule.findMany({ where: { enabled: true }, orderBy: { code: 'asc' } }),
    getSetting('aml.holdScore', client),
    getSetting('aml.matchThreshold', client),
  ]);
  const hits: RuleHit[] = [];
  const hit = (
    rule: (typeof rules)[number],
    message: string,
    details: RuleHit['details'],
  ): void => {
    hits.push({
      ruleCode: rule.code,
      ruleType: rule.type,
      severity: rule.severity,
      score: rule.score,
      action: rule.action,
      message,
      details,
    });
  };

  const velocity = async (
    windowHours: number,
    minUsd?: bigint,
    maxUsd?: bigint,
  ): Promise<VelocityRow> => {
    if (!input.senderUserId) return { count: 0n, value: 0n };
    const since = new Date(input.now.getTime() - windowHours * 3_600_000);
    // `input.now` is when the request started — before it queued for the sender's lock. A
    // request that started later may have committed first, with a later timestamp; closing the
    // window exactly at `now` hid it and let parallel requests slip under the velocity and
    // structuring rules. The slack outlasts the longest a request can queue (maxWait + timeout).
    const until = new Date(input.now.getTime() + QUEUE_SLACK_MS);
    const rows = await client.$queryRaw<VelocityRow[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(send_amount_usd), 0) AS value
      FROM transfers
      WHERE sender_user_id = ${input.senderUserId}::uuid
        AND type <> 'TOPUP'
        AND status IN ('PROCESSING', 'ON_HOLD', 'COMPLETED')
        AND created_at >= ${since} AND created_at <= ${until}
        AND (${minUsd ?? null}::bigint IS NULL OR send_amount_usd >= ${minUsd ?? null}::bigint)
        AND (${maxUsd ?? null}::bigint IS NULL OR send_amount_usd < ${maxUsd ?? null}::bigint)`;
    return rows[0] ?? { count: 0n, value: 0n };
  };

  let countryRisk: Map<string, RiskLevel> | undefined;
  const riskOf = async (code: string): Promise<RiskLevel> => {
    if (!countryRisk) {
      const countries = await client.country.findMany({
        where: { code: { in: [input.sourceCountry, input.targetCountry] } },
        select: { code: true, riskLevel: true },
      });
      countryRisk = new Map(countries.map((country) => [country.code, country.riskLevel]));
    }
    return countryRisk.get(code) ?? 'LOW';
  };

  for (const rule of rules) {
    switch (rule.type) {
      case 'AMOUNT_THRESHOLD': {
        const params = AML_RULE_PARAM_SCHEMAS.AMOUNT_THRESHOLD.safeParse(rule.params);
        if (params.success && input.amountUsd >= params.data.thresholdUsd) {
          hit(
            rule,
            `Amount ${usdText(input.amountUsd)} is at or above ${usdText(params.data.thresholdUsd)}`,
            {
              amountUsd: input.amountUsd.toString(),
              thresholdUsd: params.data.thresholdUsd.toString(),
            },
          );
        }
        break;
      }
      case 'VELOCITY_COUNT': {
        const params = AML_RULE_PARAM_SCHEMAS.VELOCITY_COUNT.safeParse(rule.params);
        if (!params.success) break;
        const row = await velocity(params.data.windowHours);
        const count = Number(toBigInt(row.count)) + 1;
        if (count > params.data.maxCount) {
          hit(
            rule,
            `${count} transfers in ${params.data.windowHours} h (limit ${params.data.maxCount})`,
            {
              count,
              windowHours: params.data.windowHours,
            },
          );
        }
        break;
      }
      case 'VELOCITY_VALUE': {
        const params = AML_RULE_PARAM_SCHEMAS.VELOCITY_VALUE.safeParse(rule.params);
        if (!params.success) break;
        const row = await velocity(params.data.windowHours);
        const value = toBigInt(row.value) + input.amountUsd;
        if (value > params.data.maxValueUsd) {
          hit(
            rule,
            `${usdText(value)} sent in ${params.data.windowHours} h (limit ${usdText(params.data.maxValueUsd)})`,
            {
              valueUsd: value.toString(),
              windowHours: params.data.windowHours,
            },
          );
        }
        break;
      }
      case 'STRUCTURING': {
        const params = AML_RULE_PARAM_SCHEMAS.STRUCTURING.safeParse(rule.params);
        if (!params.success) break;
        const lower = (params.data.thresholdUsd * BigInt(params.data.bandPercent)) / 100n;
        if (input.amountUsd < lower || input.amountUsd >= params.data.thresholdUsd) break;
        const row = await velocity(params.data.windowHours, lower, params.data.thresholdUsd);
        const count = Number(toBigInt(row.count)) + 1;
        if (count >= params.data.minCount) {
          hit(
            rule,
            `${count} transfers just under ${usdText(params.data.thresholdUsd)} in ${params.data.windowHours} h`,
            {
              count,
              thresholdUsd: params.data.thresholdUsd.toString(),
            },
          );
        }
        break;
      }
      case 'NEW_ACCOUNT_HIGH_VALUE': {
        const params = AML_RULE_PARAM_SCHEMAS.NEW_ACCOUNT_HIGH_VALUE.safeParse(rule.params);
        if (!params.success || !input.senderCreatedAt) break;
        const ageDays = Math.floor(
          (input.now.getTime() - input.senderCreatedAt.getTime()) / 86_400_000,
        );
        if (ageDays < params.data.accountAgeDays && input.amountUsd >= params.data.thresholdUsd) {
          hit(
            rule,
            `Account is ${Math.max(ageDays, 0)} day(s) old and sends ${usdText(input.amountUsd)}`,
            {
              accountAgeDays: Math.max(ageDays, 0),
              amountUsd: input.amountUsd.toString(),
            },
          );
        }
        break;
      }
      case 'HIGH_RISK_CORRIDOR': {
        const params = AML_RULE_PARAM_SCHEMAS.HIGH_RISK_CORRIDOR.safeParse(rule.params);
        if (!params.success || input.amountUsd < params.data.thresholdUsd) break;
        const [source, target] = await Promise.all([
          riskOf(input.sourceCountry),
          riskOf(input.targetCountry),
        ]);
        if (source === 'HIGH' || target === 'HIGH') {
          hit(rule, `High-risk corridor ${input.sourceCountry} → ${input.targetCountry}`, {
            sourceCountry: input.sourceCountry,
            targetCountry: input.targetCountry,
          });
        }
        break;
      }
      case 'SANCTIONS_MATCH': {
        const params = AML_RULE_PARAM_SCHEMAS.SANCTIONS_MATCH.safeParse(rule.params);
        if (!params.success) break;
        for (const [party, name] of [
          ['sender', input.senderName],
          ['recipient', input.recipientName],
        ] as const) {
          const matches = await screenName(client, name, {
            threshold,
            listType: params.data.listType,
          });
          const best = matches[0];
          if (best) {
            hit(
              rule,
              `${party === 'sender' ? 'Sender' : 'Recipient'} name matches ${best.listName}: "${best.matchedName}" (${best.score}%)`,
              {
                party,
                matchedName: best.matchedName,
                listName: best.listName,
                matchScore: best.score,
                entryId: best.entryId,
              },
            );
          }
        }
        break;
      }
    }
  }

  const score = hits.reduce((total, current) => total + current.score, 0);
  const decision =
    hits.length === 0
      ? 'CLEAR'
      : hits.some((current) => current.action === 'HOLD') || score >= holdScore
        ? 'HOLD'
        : 'FLAG';
  return { decision, score, hits };
}

const SEVERITY_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Human reference for AML cases, e.g. `AML-2026-7K3M9Q`. */
export const newCaseReference = (now: Date = new Date()): string =>
  `AML-${now.getUTCFullYear()}-${randomCode(6)}`;

/**
 * Persists the outcome of a screening: one alert per hit and — when the decision is HOLD — a
 * case that groups them, with compliance notified. Returns the case id, if any.
 */
export async function recordScreening(
  tx: Tx,
  input: {
    transferId: string;
    transferReference: string;
    userId: string | null;
    result: ScreeningResult;
    now: Date;
  },
): Promise<{ caseId: string | null }> {
  const { result } = input;
  if (result.hits.length === 0) return { caseId: null };
  let caseId: string | null = null;
  if (result.decision === 'HOLD') {
    const priority = result.hits.reduce<RiskLevel>(
      (highest, current) =>
        SEVERITY_RANK[current.severity] > SEVERITY_RANK[highest] ? current.severity : highest,
      'LOW',
    );
    const created = await tx.amlCase.create({
      data: {
        reference: newCaseReference(input.now),
        subjectUserId: input.userId,
        transferId: input.transferId,
        priority,
        summary: `Transfer ${input.transferReference} held: ${result.hits.map((current) => current.ruleCode).join(', ')}`,
        createdAt: input.now,
      },
      select: { id: true, reference: true },
    });
    caseId = created.id;
    await notifyRoles(tx, ['COMPLIANCE', 'ADMIN'], {
      type: 'aml.case.opened',
      title: 'Transfer held for review',
      body: `${created.reference} — ${input.transferReference} (score ${result.score})`,
      href: `/admin/aml/cases/${created.id}`,
      at: input.now,
    });
  }
  await tx.amlAlert.createMany({
    data: result.hits.map((current) => ({
      userId: input.userId,
      transferId: input.transferId,
      caseId,
      ruleCode: current.ruleCode,
      ruleType: current.ruleType,
      severity: current.severity,
      score: current.score,
      action: current.action,
      message: current.message,
      details: current.details,
      status: caseId ? ('ESCALATED' as const) : ('OPEN' as const),
      createdAt: input.now,
    })),
  });
  return { caseId };
}

// ---------------------------------------------------------------------------
// Customer risk profile
// ---------------------------------------------------------------------------

export interface RiskFactor {
  readonly code: string;
  readonly label: string;
  readonly points: number;
}

export interface RiskProfile {
  readonly score: number;
  readonly level: RiskLevel;
  readonly factors: readonly RiskFactor[];
  readonly pepMatch: boolean;
  readonly sanctionsMatch: boolean;
}

export const riskLevelForScore = (score: number): RiskLevel =>
  score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';

/**
 * Recomputes and stores a customer's risk score (0–100) from KYC status, account age, country
 * risk, name screening and alert history.
 */
export async function assessUserRisk(
  client: DbOrTx,
  userId: string,
  now: Date = new Date(),
): Promise<RiskProfile> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      fullName: true,
      kycStatus: true,
      kycTier: true,
      createdAt: true,
      country: { select: { riskLevel: true } },
    },
  });
  if (!user) return { score: 0, level: 'LOW', factors: [], pepMatch: false, sanctionsMatch: false };

  const factors: RiskFactor[] = [];
  if (user.kycStatus !== 'VERIFIED') {
    factors.push({ code: 'KYC_UNVERIFIED', label: 'Identity not verified', points: 15 });
  }
  const ageDays = (now.getTime() - user.createdAt.getTime()) / 86_400_000;
  if (ageDays < 30)
    factors.push({ code: 'NEW_ACCOUNT', label: 'Account younger than 30 days', points: 10 });
  if (user.country?.riskLevel === 'HIGH') {
    factors.push({ code: 'COUNTRY_HIGH', label: 'High-risk country of residence', points: 25 });
  } else if (user.country?.riskLevel === 'MEDIUM') {
    factors.push({ code: 'COUNTRY_MEDIUM', label: 'Medium-risk country of residence', points: 10 });
  }

  const hits = await screenName(client, user.fullName);
  const sanctionsMatch = hits.some((current) => current.type === 'SANCTION');
  const pepMatch = hits.some((current) => current.type === 'PEP');
  if (sanctionsMatch)
    factors.push({
      code: 'SANCTIONS_MATCH',
      label: 'Name matches the demo sanctions list',
      points: 60,
    });
  if (pepMatch)
    factors.push({ code: 'PEP_MATCH', label: 'Name matches the demo PEP list', points: 30 });

  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [alerts, rejected] = await Promise.all([
    client.amlAlert.count({
      where: { userId, createdAt: { gte: since }, status: { in: ['OPEN', 'ESCALATED'] } },
    }),
    client.transfer.count({
      where: { senderUserId: userId, status: 'REJECTED', createdAt: { gte: since } },
    }),
  ]);
  if (alerts > 0) {
    factors.push({
      code: 'OPEN_ALERTS',
      label: `${alerts} open AML alert(s) in 90 days`,
      points: Math.min(alerts * 10, 30),
    });
  }
  if (rejected > 0) {
    factors.push({
      code: 'REJECTED_TRANSFERS',
      label: `${rejected} transfer(s) rejected by compliance`,
      points: 20,
    });
  }

  const score = Math.min(
    factors.reduce((total, factor) => total + factor.points, 0),
    100,
  );
  const level = riskLevelForScore(score);
  await client.user.update({
    where: { id: userId },
    data: {
      riskScore: score,
      riskLevel: level,
      riskFactors: factors as unknown as Prisma.InputJsonValue,
      riskAssessedAt: now,
      pepMatch,
      sanctionsMatch,
    },
  });
  return { score, level, factors, pepMatch, sanctionsMatch };
}

/** Convenience for callers outside a transaction. */
export const refreshUserRisk = (userId: string): Promise<RiskProfile> => assessUserRisk(db, userId);
