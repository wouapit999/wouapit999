import Link from "next/link";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay } from "@/lib/format";
import { Badge, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Tr, parsePage } from "@/components/ui";
import { reconciliationMessages } from "./messages";

export const metadata = { title: "Reconciliation" };
const PAGE_SIZE = 25;

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("payment.approve");
  const { t } = await getT(reconciliationMessages);
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const where = { organizationId: ctx.organizationId };
  const [total, sessions, settings] = await Promise.all([
    db.reconciliationSession.count({ where }),
    db.reconciliationSession.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    getOrgSettings(ctx.organizationId),
  ]);
  const prefs = { dateFormat: settings?.dateFormat };

  return (
    <>
      <PageHeader title={t("rec.title")} description={t("rec.subtitle")} actions={<LinkButton href="/reconciliation/new">{t("rec.new")}</LinkButton>} />
      {sessions.length === 0 ? (
        <EmptyState title={t("rec.empty")} description={t("rec.emptyHint")} action={<LinkButton href="/reconciliation/new">{t("rec.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("rec.account")}</Th>
              <Th>{t("rec.period")}</Th>
              <Th className="text-right">{t("rec.lines")}</Th>
              <Th className="text-right">{t("rec.matched")}</Th>
              <Th className="text-right">{t("rec.unmatched")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("common.date")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sessions.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <Link className="font-medium text-[var(--brand)] hover:underline" href={`/reconciliation/${s.id}`}>{s.account}</Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDay(s.periodStart, prefs)} → {formatDay(s.periodEnd, prefs)}</Td>
                <Td className="text-right">{s.matchedCount + s.unmatchedCount}</Td>
                <Td className="text-right text-green-700 dark:text-green-400">{s.matchedCount}</Td>
                <Td className="text-right text-amber-700 dark:text-amber-400">{s.unmatchedCount}</Td>
                <Td><Badge status={s.status}>{t(`rec.status.${s.status}`)}</Badge></Td>
                <Td className="whitespace-nowrap">{formatDay(s.createdAt, prefs)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/reconciliation" />
    </>
  );
}
