import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, paymentWhere, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { appBaseUrl } from "@/lib/notify/email";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { ReceiptView, type ReceiptSnapshot } from "@/components/finance/receipt-view";
import { PrintButton } from "@/components/print-button";
import { financeMessages } from "../../invoices/messages";
import { receiptMessages } from "../messages";

export const metadata = { title: "Receipt" };

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("receipt.view");
  const { t, locale } = await getT(financeMessages, receiptMessages);
  const receipt = await db.receipt.findFirst({
    where: { AND: [{ organizationId: ctx.organizationId, id }, { payment: paymentWhere(ctx) }] },
    include: { payment: { select: { id: true, status: true } } },
  });
  if (!receipt) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const reversed = receipt.payment.status === "REVERSED";

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`${t("fin.receipt")} ${receipt.number}`}
          breadcrumbs={[{ label: t("rct.title"), href: "/receipts" }, { label: receipt.number }]}
          actions={
            <>
              {reversed ? <Badge tone="red">{t("rct.reversed")}</Badge> : <Badge tone="green">{t("rct.valid")}</Badge>}
              <PrintButton label={t("fin.print")} />
              {can(ctx, "payment.view") && <LinkButton variant="secondary" href={`/payments/${receipt.payment.id}`}>{t("rct.viewPayment")}</LinkButton>}
            </>
          }
        />
      </div>
      <ReceiptView
        number={receipt.number}
        issuedAt={formatDateTime(receipt.issuedAt, df)}
        verificationCode={receipt.verificationCode}
        snapshot={receipt.snapshot as unknown as ReceiptSnapshot}
        reversed={reversed}
        locale={locale}
        verifyUrl={`${appBaseUrl()}/verify/${receipt.verificationCode}`}
      />
    </>
  );
}
