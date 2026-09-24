import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { planProgress } from "@/domain/payment-plan";
import { planWhere } from "./data";
import { PLAN_STATUSES, paymentPlanMessages } from "./messages";

export const metadata = { title: "Payment plans" };
const PAGE_SIZE = 25;

export default async function PaymentPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("arrears.view");
  const { t, locale } = await getT(paymentPlanMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const status = str(sp.status);
  const page = parsePage(sp.page);

  const filters: Prisma.PaymentPlanWhereInput[] = [planWhere(ctx)];
  if ((PLAN_STATUSES as readonly string[]).includes(status)) filters.push({ status });
  if (q) filters.push({ tenant: { OR: [{ legalName: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }] } });
  const where: Prisma.PaymentPlanWhereInput = { AND: filters };

  const [settings, total, rows] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.paymentPlan.count({ where }),
    db.paymentPlan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { tenant: { select: { id: true, legalName: true, reference: true } }, installments: { orderBy: { sequence: "asc" } } },
    }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };
  const manage = can(ctx, "arrears.manage");

  return (
    <>
      <PageHeader title={t("pp.title")} description={t("pp.subtitle")} actions={manage && <LinkButton href="/payment-plans/new">{t("pp.new")}</LinkButton>} />
      <FilterBar action="/payment-plans">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={PLAN_STATUSES.map((v) => ({ value: v, label: t(`pp.status.${v}`) }))} wrapperClassName="w-full sm:w-44" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("pp.empty")} description={t("pp.emptyHint")} action={manage && <LinkButton href="/payment-plans/new">{t("pp.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("pp.tenant")}</Th>
              <Th className="text-right">{t("pp.totalAmount")}</Th>
              <Th className="text-right">{t("pp.paid")}</Th>
              <Th>{t("pp.progress")}</Th>
              <Th>{t("pp.installments")}</Th>
              <Th>{t("pp.nextDue")}</Th>
              <Th>{t("pp.created")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => {
              const prog = planProgress(p.installments);
              const next = p.installments.find((i) => i.status !== "PAID");
              const paidCount = p.installments.filter((i) => i.status === "PAID").length;
              return (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/payment-plans/${p.id}`} className="font-medium text-[var(--brand)] hover:underline">{p.tenant.legalName}</Link>
                    <div className="text-xs text-slate-500">{p.tenant.reference}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.totalAmount, fmt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(prog.paid, fmt)}</Td>
                  <Td className="min-w-32">
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={prog.percent} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-[var(--brand)]" style={{ width: `${prog.percent}%` }} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{prog.percent}%</div>
                  </Td>
                  <Td className="tabular-nums">{paidCount}/{p.installments.length}</Td>
                  <Td className="whitespace-nowrap">{next && p.status === "ACTIVE" ? formatDay(next.dueDate, df) : "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDay(p.createdAt, df)}</Td>
                  <Td><Badge status={p.status}>{t(`pp.status.${p.status}`)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/payment-plans" params={{ q, status }} />
    </>
  );
}
