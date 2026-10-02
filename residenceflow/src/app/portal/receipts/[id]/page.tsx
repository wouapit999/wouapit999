import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { appBaseUrl } from "@/lib/notify/email";
import { ReceiptView, type ReceiptSnapshot } from "@/components/finance/receipt-view";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { OccupantNotice, portalPage } from "../../kit";

export const metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

export default async function PortalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, tenantId, t, locale, df, occupant } = await portalPage();
  if (occupant) return <OccupantNotice t={t} title={t("nav.portal.receipts")} />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const receipt = await db.receipt.findFirst({
    where: { id, organizationId: ctx.organizationId, payment: { tenantId } },
    include: { payment: { select: { status: true } } },
  });
  if (!receipt) notFound();
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={receipt.number}
          breadcrumbs={[{ label: t("nav.portal.receipts"), href: "/portal/receipts" }, { label: receipt.number }]}
          actions={<PrintButton label={t("portal.print")} />}
        />
      </div>
      <div className="overflow-x-auto">
        <ReceiptView
          number={receipt.number}
          issuedAt={formatDateTime(receipt.issuedAt, df)}
          verificationCode={receipt.verificationCode}
          snapshot={receipt.snapshot as unknown as ReceiptSnapshot}
          reversed={receipt.payment.status === "REVERSED"}
          locale={locale}
          verifyUrl={`${appBaseUrl()}/verify/${receipt.verificationCode}`}
        />
      </div>
    </>
  );
}
