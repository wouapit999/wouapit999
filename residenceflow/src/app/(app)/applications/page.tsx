import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, propertyWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { Alert, Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { unitLabel } from "../leases/data";
import { applicationWhere, applicationsEnabled, parseChecklist } from "./data";
import { APPLICATION_STATUSES, applicationMessages } from "./messages";

export const metadata = { title: "Applications" };
const PAGE_SIZE = 25;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext(["lease.view", "lease.create"]);
  const { t, locale } = await getT(applicationMessages);
  const header = (
    <PageHeader
      title={t("app.title")}
      description={t("app.subtitle")}
      actions={can(ctx, "lease.create") && <LinkButton href="/applications/new">{t("app.new")}</LinkButton>}
    />
  );
  if (!(await applicationsEnabled(ctx.organizationId))) {
    return (
      <>
        {header}
        <EmptyState title={t("app.disabled")} description={t("app.disabledHint")} />
      </>
    );
  }

  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const status = str(sp.status);
  const propertyId = str(sp.propertyId);
  const page = parsePage(sp.page);

  const filters: Prisma.RentalApplicationWhereInput[] = [applicationWhere(ctx)];
  if ((APPLICATION_STATUSES as readonly string[]).includes(status)) filters.push({ status });
  if (propertyId) filters.push({ unit: { propertyId } });
  if (q) {
    filters.push({
      OR: [
        { applicantName: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
        { applicantEmail: { contains: q, mode: "insensitive" } },
        { applicantPhone: { contains: q } },
      ],
    });
  }
  const where: Prisma.RentalApplicationWhereInput = { AND: filters };

  const [settings, properties, total, rows] = await Promise.all([
    getOrgSettings(ctx.organizationId),
    db.property.findMany({ where: { ...propertyWhere(ctx), status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.rentalApplication.count({ where }),
    db.rentalApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { unit: { select: { number: true, block: true, property: { select: { name: true } } } } },
    }),
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat };

  return (
    <>
      {header}
      <div className="mb-4"><Alert tone="info">{t("app.fairness")}</Alert></div>
      <FilterBar action="/applications">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={APPLICATION_STATUSES.map((v) => ({ value: v, label: t(`app.status.${v}`) }))} wrapperClassName="w-full sm:w-44" />
        <Select label={t("common.building")} name="propertyId" defaultValue={propertyId} placeholder={t("common.all")} options={properties.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-full sm:w-56" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("app.empty")} description={t("app.emptyHint")} action={can(ctx, "lease.create") && <LinkButton href="/applications/new">{t("app.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("app.reference")}</Th>
              <Th>{t("app.applicant")}</Th>
              <Th>{t("app.desiredUnit")}</Th>
              <Th>{t("app.moveIn")}</Th>
              <Th className="text-right">{t("app.income")}</Th>
              <Th>{t("app.checklist")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((a) => {
              const cl = parseChecklist(a.checklist);
              const received = cl.filter((c) => c.received).length;
              return (
                <Tr key={a.id}>
                  <Td className="font-mono text-xs"><Link href={`/applications/${a.id}`} className="text-[var(--brand)] hover:underline">{a.reference}</Link></Td>
                  <Td>
                    <Link href={`/applications/${a.id}`} className="font-medium text-[var(--brand)] hover:underline">{a.applicantName}</Link>
                    <div className="text-xs text-slate-500">{[a.applicantPhone, a.applicantEmail].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td>{a.unit ? unitLabel(a.unit) : "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDay(a.desiredMoveIn, df)}</Td>
                  <Td className="text-right tabular-nums">{a.monthlyIncome ? formatMoney(a.monthlyIncome, fmt) : "—"}</Td>
                  <Td className="tabular-nums">{received}/{cl.length}</Td>
                  <Td><Badge status={a.status}>{t(`app.status.${a.status}`)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/applications" params={{ q, status, propertyId }} />
    </>
  );
}
