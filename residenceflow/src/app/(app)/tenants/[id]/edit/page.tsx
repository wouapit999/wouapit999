import { notFound } from "next/navigation";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { loadScopedTenant } from "@/services/tenants";
import { Card, PageHeader } from "@/components/ui";
import { TenantForm } from "../../tenant-form";
import { updateTenantAction } from "../../actions";
import { tenantMessages } from "../../messages";

export const metadata = { title: "Edit tenant" };

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("tenant.update");
  const { t } = await getT(tenantMessages);
  const tenant = await loadScopedTenant(ctx, id);
  if (!tenant) notFound();
  const showNotes = can(ctx, "tenant.notes.view");
  return (
    <>
      <PageHeader title={t("tenant.edit")} breadcrumbs={[{ label: t("tenant.title"), href: "/tenants" }, { label: tenant.legalName, href: `/tenants/${id}` }, { label: t("common.edit") }]} />
      <Card><TenantForm action={updateTenantAction} tenant={showNotes ? tenant : { ...tenant, notes: "" }} showNotes={showNotes} t={t} /></Card>
    </>
  );
}
