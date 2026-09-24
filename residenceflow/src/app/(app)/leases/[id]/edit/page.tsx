import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { leaseWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Alert, Card, LinkButton, PageHeader } from "@/components/ui";
import { LeaseForm } from "../../lease-form";
import { updateDraftLeaseAction } from "../../actions";
import { leasableTenants, unitLabel } from "../../data";
import { leaseMessages } from "../../messages";

export const metadata = { title: "Edit lease" };

export default async function EditLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("lease.create");
  const { t } = await getT(leaseMessages);
  const lease = await db.lease.findFirst({
    where: { ...leaseWhere(ctx), id },
    include: { unit: { include: { property: { select: { name: true } } } } },
  });
  if (!lease) notFound();
  const header = (
    <PageHeader title={t("lease.edit")} breadcrumbs={[{ label: t("lease.title"), href: "/leases" }, { label: lease.reference, href: `/leases/${id}` }, { label: t("common.edit") }]} />
  );
  if (lease.status !== "DRAFT") {
    return (
      <>
        {header}
        <Alert tone="warn">{t("lease.draftOnly")}</Alert>
        <div className="mt-4"><LinkButton variant="secondary" href={`/leases/${id}`}>{t("common.back")}</LinkButton></div>
      </>
    );
  }
  const tenants = await leasableTenants(ctx, lease.tenantId);
  const { unit, ...leaseOnly } = lease;
  return (
    <>
      {header}
      <Card>
        <LeaseForm
          action={updateDraftLeaseAction}
          lease={leaseOnly}
          unit={{ id: unit.id, label: unitLabel(unit) }}
          tenants={tenants}
          defaults={{ rentAmount: "", serviceCharge: "0", depositAmount: "0", frequency: "MONTHLY", graceDays: 5, lateFeeType: "NONE", lateFeeValue: "0" }}
          t={t}
        />
      </Card>
    </>
  );
}
