import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { InvoiceView } from "@/components/finance/invoice-view";
import { PrintButton } from "@/components/print-button";
import { LinkButton, PageHeader } from "@/components/ui";
import { OccupantNotice, portalPage } from "../../kit";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function PortalInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, tenantId, t, locale, settings, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.billing")} />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const invoice = await db.invoice.findFirst({
    where: { id, tenantId, organizationId: ctx.organizationId, status: { not: "DRAFT" } },
    include: {
      lines: true,
      tenant: { select: { legalName: true, reference: true, postalAddress: true, email: true } },
      lease: { select: { unit: { select: { number: true, property: { select: { name: true } } } } } },
    },
  });
  if (!invoice) notFound();
  const unitLabel = invoice.lease ? `${invoice.lease.unit.property.name} · ${invoice.lease.unit.number}` : undefined;
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={invoice.number}
          breadcrumbs={[{ label: t("nav.portal.billing"), href: "/portal/billing" }, { label: invoice.number }]}
          actions={
            <>
              <PrintButton label={t("portal.print")} />
              <LinkButton variant="secondary" href="/portal/payments#submit">{t("portal.pay.submitProof")}</LinkButton>
            </>
          }
        />
      </div>
      <div className="overflow-x-auto">
        <InvoiceView invoice={invoice} lines={invoice.lines} tenant={invoice.tenant} settings={settings} unitLabel={unitLabel} locale={locale} />
      </div>
    </>
  );
}
