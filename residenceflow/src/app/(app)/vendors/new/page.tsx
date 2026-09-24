import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, PageHeader } from "@/components/ui";
import { VendorForm } from "../vendor-form";
import { createVendorAction } from "../actions";
import { vendorMessages } from "../messages";

export const metadata = { title: "New vendor" };

export default async function NewVendorPage() {
  await requireContext("vendor.manage");
  const { t } = await getT(vendorMessages);
  return (
    <>
      <PageHeader title={t("ven.new")} breadcrumbs={[{ label: t("ven.title"), href: "/vendors" }, { label: t("ven.new") }]} />
      <Card><VendorForm action={createVendorAction} t={t} /></Card>
    </>
  );
}
