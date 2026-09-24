import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { can, invoiceWhere, leaseWhere, maintenanceWhere, propertyWhere, requireContext, tenantWhere, unitWhere } from "@/lib/auth/context";
import { getT, type T } from "@/i18n";
import { Badge, Card, EmptyState, Input, PageHeader, buttonClass, str } from "@/components/ui";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";
const TAKE = 10;

const searchMessages = {
  en: {
    "search.title": "Search",
    "search.subtitle": "Buildings, units, tenants, leases, invoices and work orders you have access to.",
    "search.placeholder": "Name, reference, number…",
    "search.tooShort": "Type at least 2 characters.",
    "search.none": "No results for “{q}”.",
    "search.buildings": "Buildings",
    "search.units": "Units",
    "search.tenants": "Tenants",
    "search.leases": "Leases",
    "search.invoices": "Invoices",
    "search.workOrders": "Work orders",
    "search.more": "Showing the first {n} results.",
  },
  fr: {
    "search.title": "Recherche",
    "search.subtitle": "Immeubles, logements, locataires, baux, factures et interventions auxquels vous avez accès.",
    "search.placeholder": "Nom, référence, numéro…",
    "search.tooShort": "Saisissez au moins 2 caractères.",
    "search.none": "Aucun résultat pour « {q} ».",
    "search.buildings": "Immeubles",
    "search.units": "Logements",
    "search.tenants": "Locataires",
    "search.leases": "Baux",
    "search.invoices": "Factures",
    "search.workOrders": "Interventions",
    "search.more": "Affichage des {n} premiers résultats.",
  },
};

type Hit = { id: string; href: string; title: string; sub?: string; status?: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("dashboard.view");
  const { t } = await getT(searchMessages);
  const q = str((await searchParams).q).trim().slice(0, 100);
  const ok = q.length >= 2;
  const ci = { contains: q, mode: "insensitive" as const };

  const [buildings, units, tenants, leases, invoices, workOrders] = ok
    ? await Promise.all([
        can(ctx, "building.view")
          ? db.property.findMany({ where: { ...propertyWhere(ctx), OR: [{ name: ci }, { reference: ci }, { city: ci }, { address: ci }] }, take: TAKE, orderBy: { name: "asc" }, select: { id: true, name: true, reference: true, city: true, status: true } })
          : [],
        can(ctx, "unit.view")
          ? db.unit.findMany({ where: { ...unitWhere(ctx), archived: false, OR: [{ number: ci }, { block: ci }, { property: { name: ci } }] }, take: TAKE, orderBy: { number: "asc" }, select: { id: true, number: true, block: true, status: true, property: { select: { name: true } } } })
          : [],
        can(ctx, "tenant.view")
          ? db.tenant.findMany({ where: { ...tenantWhere(ctx), OR: [{ legalName: ci }, { preferredName: ci }, { reference: ci }, { email: ci }, { phone: ci }] }, take: TAKE, orderBy: { legalName: "asc" }, select: { id: true, legalName: true, reference: true, phone: true, status: true } })
          : [],
        can(ctx, "lease.view")
          ? db.lease.findMany({ where: { ...leaseWhere(ctx), OR: [{ reference: ci }, { tenant: { legalName: ci } }, { unit: { number: ci } }] }, take: TAKE, orderBy: { startDate: "desc" }, select: { id: true, reference: true, status: true, tenant: { select: { legalName: true } }, unit: { select: { number: true, property: { select: { name: true } } } } } })
          : [],
        can(ctx, "invoice.view")
          ? db.invoice.findMany({ where: { ...invoiceWhere(ctx), number: ci }, take: TAKE, orderBy: { issueDate: "desc" }, select: { id: true, number: true, status: true, tenant: { select: { legalName: true } } } })
          : [],
        can(ctx, "maintenance.view")
          ? db.maintenanceRequest.findMany({ where: { AND: [maintenanceWhere(ctx), { OR: [{ number: ci }, { title: ci }] }] }, take: TAKE, orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true, status: true, property: { select: { name: true } } } })
          : [],
      ])
    : [[], [], [], [], [], []];

  const groups: { key: string; hits: Hit[] }[] = [
    { key: "search.buildings", hits: buildings.map((b) => ({ id: b.id, href: `/properties/${b.id}`, title: b.name, sub: [b.reference, b.city].filter(Boolean).join(" · "), status: b.status })) },
    { key: "search.units", hits: units.map((u) => ({ id: u.id, href: `/units/${u.id}`, title: `${u.property.name} · ${u.block ? `${u.block} ` : ""}${u.number}`, status: u.status })) },
    { key: "search.tenants", hits: tenants.map((x) => ({ id: x.id, href: `/tenants/${x.id}`, title: x.legalName, sub: [x.reference, x.phone].filter(Boolean).join(" · "), status: x.status })) },
    { key: "search.leases", hits: leases.map((l) => ({ id: l.id, href: `/leases/${l.id}`, title: l.reference, sub: `${l.tenant.legalName} · ${l.unit.property.name} ${l.unit.number}`, status: l.status })) },
    { key: "search.invoices", hits: invoices.map((i) => ({ id: i.id, href: `/invoices/${i.id}`, title: i.number, sub: i.tenant.legalName, status: i.status })) },
    { key: "search.workOrders", hits: workOrders.map((w) => ({ id: w.id, href: `/maintenance/${w.id}`, title: `${w.number} · ${w.title}`, sub: w.property.name, status: w.status })) },
  ];
  const any = groups.some((g) => g.hits.length > 0);

  return (
    <>
      <PageHeader title={t("search.title")} description={t("search.subtitle")} />
      <form method="get" action="/search" role="search" className="mb-6 flex flex-wrap items-end gap-2">
        <Input label={t("common.search")} name="q" type="search" defaultValue={q} placeholder={t("search.placeholder")} wrapperClassName="w-full max-w-md" autoFocus minLength={2} maxLength={100} />
        <button type="submit" className={buttonClass("primary")}>{t("common.search")}</button>
      </form>
      {!ok ? (
        q ? <p className="text-sm text-slate-500">{t("search.tooShort")}</p> : null
      ) : !any ? (
        <EmptyState title={t("search.none", { q })} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.filter((g) => g.hits.length > 0).map((g) => (
            <ResultGroup key={g.key} title={`${t(g.key)} (${g.hits.length})`} t={t}>
              {g.hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={h.href} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium text-[var(--brand)]">{h.title}</span>
                    {h.sub && <span className="block truncate text-xs text-slate-500">{h.sub}</span>}
                  </Link>
                  {h.status && <Badge status={h.status} />}
                </li>
              ))}
              {g.hits.length === TAKE && <li className="pt-2 text-xs text-slate-500">{t("search.more", { n: TAKE })}</li>}
            </ResultGroup>
          ))}
        </div>
      )}
    </>
  );
}

function ResultGroup({ title, children }: { title: string; t: T; children: ReactNode }) {
  return (
    <Card title={title}>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">{children}</ul>
    </Card>
  );
}
