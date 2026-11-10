import type { Metadata } from 'next';
import { z } from 'zod';

import { Tabs } from '@/components/admin/filter-bar';
import {
  type SearchParams,
  enumParam,
  flattenParams,
  pageParam,
  textParam,
  uuidParam,
} from '@/components/admin/helpers';
import { Alert, PageHeader } from '@/components/ui';
import { getPageContext, requirePermission } from '@/server/auth/session';
import { listAlerts, listCases } from '@/server/aml';
import { STAFF_ROLES, roleHasPermission } from '@/server/rbac';

import {
  AlertsSection,
  CasesSection,
  OverviewSection,
  RulesSection,
  SarsSection,
  ScreeningSection,
} from './_sections';

export const metadata: Metadata = { title: 'Compliance' };

const TABS = ['overview', 'alerts', 'cases', 'sars', 'rules', 'screening'] as const;
const querySchema = z.object({
  tab: enumParam(TABS),
  status: textParam,
  severity: enumParam(['LOW', 'MEDIUM', 'HIGH']),
  type: enumParam(['SANCTION', 'PEP']),
  q: textParam,
  edit: uuidParam,
  saved: textParam,
  page: pageParam,
});

/** Compliance workspace (phase 8): alerts → cases → release / reject → SAR, rules, screening. */
export default async function CompliancePage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('aml:read');
  const { ctx, user } = await getPageContext(...STAFF_ROLES);
  const query = querySchema.parse(flattenParams(await searchParams));
  const tab = query.tab ?? 'overview';
  const [openAlerts, openCases, reviewCases] = await Promise.all([
    listAlerts(ctx, { status: 'OPEN', pageSize: 1 }),
    listCases(ctx, { status: 'OPEN', pageSize: 1 }),
    listCases(ctx, { status: 'UNDER_REVIEW', pageSize: 1 }),
  ]);
  const permissions = {
    write: roleHasPermission(user.role, 'aml:write'),
    sar: roleHasPermission(user.role, 'sar:write'),
    sanctions: roleHasPermission(user.role, 'sanctions:write'),
  };

  return (
    <>
      <PageHeader
        title="Compliance"
        description="AML and fraud monitoring: alerts raised by the rule engine, investigation cases, held transfers, suspicious activity reports, rules and the screening list."
      />
      {!permissions.write ? (
        <Alert tone="info" className="mb-5">
          You have read-only access. Decisions are taken by compliance officers and administrators.
        </Alert>
      ) : null}
      <Tabs
        label="Compliance sections"
        active={tab}
        tabs={[
          { key: 'overview', label: 'Dashboard', href: '/admin/compliance' },
          {
            key: 'alerts',
            label: 'Alerts',
            href: '/admin/compliance?tab=alerts',
            count: openAlerts.total,
          },
          {
            key: 'cases',
            label: 'Cases',
            href: '/admin/compliance?tab=cases',
            count: openCases.total + reviewCases.total,
          },
          { key: 'sars', label: 'SARs', href: '/admin/compliance?tab=sars' },
          { key: 'rules', label: 'AML rules', href: '/admin/compliance?tab=rules' },
          { key: 'screening', label: 'Screening list', href: '/admin/compliance?tab=screening' },
        ]}
      />
      {tab === 'overview' ? <OverviewSection ctx={ctx} /> : null}
      {tab === 'alerts' ? (
        <AlertsSection
          ctx={ctx}
          canWrite={permissions.write}
          status={query.status}
          severity={query.severity}
          page={query.page}
        />
      ) : null}
      {tab === 'cases' ? <CasesSection ctx={ctx} status={query.status} page={query.page} /> : null}
      {tab === 'sars' ? <SarsSection ctx={ctx} status={query.status} /> : null}
      {tab === 'rules' ? (
        <RulesSection
          ctx={ctx}
          canWrite={permissions.write}
          editId={query.edit}
          saved={query.saved}
        />
      ) : null}
      {tab === 'screening' ? (
        <ScreeningSection
          ctx={ctx}
          canWrite={permissions.sanctions}
          type={query.type}
          search={query.q}
        />
      ) : null}
    </>
  );
}
