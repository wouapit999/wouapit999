import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, PageHeader } from "@/components/ui";
import { TenantForm } from "../tenant-form";
import { createTenantAction } from "../actions";
import { tenantMessages } from "../messages";

export const metadata = { title: "New tenant" };

export default async function NewTenantPage() {
  const ctx = await requireContext("tenant.create");
  const { t } = await getT(tenantMessages);
  return (
    <>
      <PageHeader title={t("tenant.new")} breadcrumbs={[{ label: t("tenant.title"), href: "/tenants" }, { label: t("tenant.new") }]} />
      <Card><TenantForm action={createTenantAction} showNotes={can(ctx, "tenant.notes.view")} t={t} /></Card>
    </>
  );
}
