import { writeAudit } from './audit';
import { db } from './db';
import { AppError } from './errors';
import { type ActionContext, assertPermission } from './rbac';

/**
 * Country registry (phase 13): which markets are live (`enabled`) and which are planned, plus
 * the registry of planned rails. Reads are public; switching a country needs `countries:write`.
 */

export async function listCountries(filter: { enabled?: boolean } = {}) {
  return db.country.findMany({
    where: filter.enabled === undefined ? {} : { enabled: filter.enabled },
    orderBy: [{ stage: 'asc' }, { name: 'asc' }],
  });
}

export async function getCountry(code: string) {
  return db.country.findUnique({ where: { code: code.toUpperCase() } });
}

/** Enables / disables a country for registration and transfers. Audited. */
export async function setCountryEnabled(ctx: ActionContext, code: string, enabled: boolean) {
  assertPermission(ctx, 'countries:write');
  return db.$transaction(async (tx) => {
    const before = await tx.country.findUnique({ where: { code } });
    if (!before) throw new AppError('NOT_FOUND', 'Country not found');
    const after = await tx.country.update({ where: { code }, data: { enabled } });
    await writeAudit(tx, ctx, {
      action: enabled ? 'country.enable' : 'country.disable',
      resourceType: 'country',
      resourceId: code,
      before: { enabled: before.enabled },
      after: { enabled },
    });
    return after;
  });
}

export async function setCountryRisk(
  ctx: ActionContext,
  code: string,
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
) {
  assertPermission(ctx, 'countries:write');
  return db.$transaction(async (tx) => {
    const before = await tx.country.findUnique({ where: { code } });
    if (!before) throw new AppError('NOT_FOUND', 'Country not found');
    const after = await tx.country.update({ where: { code }, data: { riskLevel } });
    await writeAudit(tx, ctx, {
      action: 'country.risk',
      resourceType: 'country',
      resourceId: code,
      before: { riskLevel: before.riskLevel },
      after: { riskLevel },
    });
    return after;
  });
}

/** Planned connectors beyond mobile money (Visa Direct, TerraPay, SWIFT…). */
export async function listRails() {
  return db.rail.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
}
