import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, leaseWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/format";
import { tenantBalance } from "@/services/billing";
import { tenantScopeWhere } from "@/services/tenants";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { TENANT_STATUSES, tenantMessages, tenantStatusTone } from "./messages";

export const metadata = { title: "Tenants" };
const PAGE_SIZE = 25;

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("tenant.view");
  const { t, locale } = await getT(tenantMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const status = str(sp.status);
  const page = parsePage(sp.page);
  const showBalance = can(ctx, "invoice.view");

  const filters: Prisma.TenantWhereInput[] = [tenantScopeWhere(ctx)];
  if ((TENANT_STATUSES as readonly string[]).includes(status)) filters.push({ status });
  else filters.push({ status: { not: "ARCHIVED" } });
  if (q) {
    filters.push({
      OR: [
        { legalName: { contains: q, mode: "insensitive" } },
        { preferredName: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { altPhone: { contains: q } },
      ],
    });
  }
  const where: Prisma.TenantWhereInput = { AND: filters };

  const [total, rows, settings] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.findMany({
      where,
      orderBy: { legalName: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        leases: {
          where: { ...leaseWhere(ctx), status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
          take: 1,
          include: { unit: { select: { id: true, number: true, block: true, property: { select: { name: true } } } } },
        },
      },
    }),
    getOrgSettings(ctx.organizationId),
  ]);
  const balances = showBalance ? await Promise.all(rows.map((r) => tenantBalance(r.id))) : [];
  const fmt = { locale, currency: settings?.currency ?? "XAF" };

  return (
    <>
      <PageHeader
        title={t("tenant.title")}
        description={t("tenant.subtitle")}
        actions={can(ctx, "tenant.create") && <LinkButton href="/tenants/new">{t("tenant.new")}</LinkButton>}
      />
      <FilterBar action="/tenants">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-64" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={TENANT_STATUSES.map((v) => ({ value: v, label: t(`tenant.status.${v}`) }))} wrapperClassName="w-full sm:w-44" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("tenant.empty")} description={t("tenant.emptyHint")} action={can(ctx, "tenant.create") && <LinkButton href="/tenants/new">{t("tenant.new")}</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("tenant.reference")}</Th>
              <Th>{t("common.name")}</Th>
              <Th>{t("common.phone")} / {t("common.email")}</Th>
              <Th>{t("tenant.currentUnit")}</Th>
              {showBalance && <Th className="text-right">{t("tenant.balance")}</Th>}
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r, i) => {
              const lease = r.leases[0];
              const bal = balances[i];
              return (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.reference}</Td>
                  <Td>
                    <Link href={`/tenants/${r.id}`} className="font-medium text-[var(--brand)] hover:underline">{r.legalName}</Link>
                    {r.preferredName && <div className="text-xs text-slate-500">{r.preferredName}</div>}
                  </Td>
                  <Td>
                    <div>{r.phone || "—"}</div>
                    <div className="text-xs text-slate-500">{r.email}</div>
                  </Td>
                  <Td>
                    {lease ? (
                      <Link className="hover:underline" href={`/units/${lease.unit.id}`}>
                        {lease.unit.property.name} · {lease.unit.block ? `${lease.unit.block} · ` : ""}{lease.unit.number}
                      </Link>
                    ) : "—"}
                  </Td>
                  {showBalance && (
                    <Td className={`whitespace-nowrap text-right ${bal && bal.net.gt(0) ? "text-red-700 dark:text-red-400" : ""}`}>
                      {bal ? formatMoney(bal.net.toString(), fmt) : "—"}
                    </Td>
                  )}
                  <Td><Badge tone={tenantStatusTone(r.status)}>{t(`tenant.status.${r.status}`)}</Badge></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/tenants" params={{ q, status }} />
    </>
  );
}
