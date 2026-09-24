import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { OPEN_WORK_ORDER_STATUSES } from "@/domain/work-order";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { vendorMessages } from "./messages";
import { VENDOR_CATEGORIES, vendorCategoryLabel } from "./vendor-form";

export const metadata = { title: "Vendors" };
const PAGE_SIZE = 25;

export default async function VendorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("vendor.view");
  const { t } = await getT(vendorMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim();
  const status = ["ACTIVE", "INACTIVE"].includes(str(sp.status)) ? str(sp.status) : "";
  const category = str(sp.category);
  const page = parsePage(sp.page);
  const where: Prisma.VendorWhereInput = {
    organizationId: ctx.organizationId,
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { contactName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.vendor.count({ where }),
    db.vendor.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { workOrders: { where: { status: { in: [...OPEN_WORK_ORDER_STATUSES] } } } } } },
    }),
  ]);

  return (
    <>
      <PageHeader title={t("ven.title")} description={t("ven.subtitle")} actions={can(ctx, "vendor.manage") && <LinkButton href="/vendors/new">{t("ven.new")}</LinkButton>} />
      <FilterBar action="/vendors">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("common.all")} options={["ACTIVE", "INACTIVE"].map((v) => ({ value: v, label: t(`ven.status.${v}`) }))} wrapperClassName="w-36" />
        <Select label={t("ven.category")} name="category" defaultValue={category} placeholder={t("common.all")} options={VENDOR_CATEGORIES.map((v) => ({ value: v, label: t(`ven.cat.${v}`) }))} wrapperClassName="w-44" />
      </FilterBar>
      {rows.length === 0 ? (
        <EmptyState title={t("ven.empty")} description={t("ven.emptyHint")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.name")}</Th>
              <Th>{t("ven.category")}</Th>
              <Th>{t("ven.contactName")}</Th>
              <Th>{t("common.phone")}</Th>
              <Th>{t("ven.openJobs")}</Th>
              <Th>{t("common.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((v) => (
              <Tr key={v.id}>
                <Td><Link href={`/vendors/${v.id}`} className="font-medium text-[var(--brand)] hover:underline">{v.name}</Link></Td>
                <Td>{vendorCategoryLabel(t, v.category)}</Td>
                <Td>{v.contactName}</Td>
                <Td>{v.phone}</Td>
                <Td>{v._count.workOrders}</Td>
                <Td><Badge status={v.status}>{t(`ven.status.${v.status}`)}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/vendors" params={{ q, status, category }} />
    </>
  );
}
