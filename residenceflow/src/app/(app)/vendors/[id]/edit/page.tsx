import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, PageHeader } from "@/components/ui";
import { VendorForm } from "../../vendor-form";
import { updateVendorAction } from "../../actions";
import { vendorMessages } from "../../messages";

export const metadata = { title: "Edit vendor" };

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("vendor.manage");
  const { t } = await getT(vendorMessages);
  const vendor = await db.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!vendor) notFound();
  return (
    <>
      <PageHeader title={t("ven.edit")} breadcrumbs={[{ label: t("ven.title"), href: "/vendors" }, { label: vendor.name, href: `/vendors/${id}` }, { label: t("common.edit") }]} />
      <Card><VendorForm action={updateVendorAction} vendor={vendor} t={t} /></Card>
    </>
  );
}
