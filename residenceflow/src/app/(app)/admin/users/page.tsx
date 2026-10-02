import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n";
import { Badge, EmptyState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Table, Td, Th, Tr, parsePage, str } from "@/components/ui";
import { adminMessages } from "../messages";
import { USER_STATUSES } from "../constants";

export const metadata = { title: "Users" };
const PAGE_SIZE = 25;

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("users.view");
  const { t } = await getT(adminMessages);
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const status = str(sp.status);
  const role = str(sp.role);
  const page = parsePage(sp.page);
  const settings = await getOrgSettings(ctx.organizationId);
  const fmt = { timezone: settings?.timezone ?? "UTC", dateFormat: settings?.dateFormat };

  const where: Prisma.UserWhereInput = {
    organizationId: ctx.organizationId || "__none__",
    ...((USER_STATUSES as readonly string[]).includes(status) ? { status: status as never } : { status: { not: "ARCHIVED" } }),
    ...(role ? { roles: { some: { roleId: role } } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, users, roles] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, status: true, lastLoginAt: true, lockedUntil: true, mfaEnabled: true, roles: { select: { role: { select: { name: true } } } } },
    }),
    db.role.findMany({ where: { organizationId: ctx.organizationId || "__none__", archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const now = new Date();
  const manage = can(ctx, "users.manage");

  return (
    <>
      <PageHeader
        title={t("adm.users.title")}
        description={t("adm.users.subtitle")}
        actions={manage && (
          <>
            <LinkButton href="/admin/users/invite">{t("adm.users.invite")}</LinkButton>
            <LinkButton href="/admin/users/import" variant="secondary">{t("adm.users.import")}</LinkButton>
          </>
        )}
      />
      <FilterBar action="/admin/users">
        <Input label={t("common.search")} name="q" defaultValue={q} wrapperClassName="w-full sm:w-56" />
        <Select label={t("common.status")} name="status" defaultValue={status} placeholder={t("adm.users.notArchived")} options={USER_STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}`) }))} wrapperClassName="w-full sm:w-44" />
        <Select label={t("adm.users.role")} name="role" defaultValue={role} placeholder={t("common.all")} options={roles.map((r) => ({ value: r.id, label: r.name }))} wrapperClassName="w-full sm:w-56" />
      </FilterBar>
      {users.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("common.name")}</Th>
              <Th>{t("adm.users.roles")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("adm.users.lastLogin")}</Th>
              <Th>{t("adm.users.security")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-[var(--brand)] hover:underline">{u.name}</Link>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </Td>
                <Td className="text-xs">{u.roles.map((r) => r.role.name).join(", ") || "—"}</Td>
                <Td><Badge status={u.status}>{t(`adm.status.${u.status}`)}</Badge></Td>
                <Td className="whitespace-nowrap text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, fmt) : t("adm.users.never")}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {u.lockedUntil && u.lockedUntil > now && <Badge tone="red">{t("adm.users.locked")}</Badge>}
                    {u.mfaEnabled && <Badge tone="green">MFA</Badge>}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/users" params={{ q, status, role }} />
    </>
  );
}
