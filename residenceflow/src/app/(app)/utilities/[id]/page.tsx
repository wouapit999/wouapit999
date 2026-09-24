import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { byPropertyWhere, can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDay, formatMoney } from "@/lib/format";
import { money } from "@/lib/money";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Badge, Card, DescriptionList, EmptyState, Field, Input, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { computeConsumption, computeUtilityAmount } from "@/domain/utilities";
import { addReadingAction, billReadingAction } from "../actions";
import { utilitiesEnabled } from "../flag";
import { utilityMessages } from "../messages";

export const metadata = { title: "Meter" };

export default async function MeterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext("unit.view");
  const { t, locale } = await getT(utilityMessages);
  if (!(await utilitiesEnabled(ctx.organizationId))) return <EmptyState title={t("util.disabled")} description={t("util.disabledHint")} />;
  const meter = await db.meter.findFirst({
    where: { ...byPropertyWhere(ctx), id },
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, number: true, block: true } },
      readings: { orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }], include: { charge: { select: { id: true, amount: true, invoiceId: true } } } },
    },
  });
  if (!meter) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const [users, invoices, lease] = await Promise.all([
    db.user.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...new Set(meter.readings.map((r) => r.recordedById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    db.invoice.findMany({ where: { organizationId: ctx.organizationId, id: { in: meter.readings.map((r) => r.charge?.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, number: true, status: true } }),
    meter.unitId
      ? db.lease.findFirst({ where: { organizationId: ctx.organizationId, unitId: meter.unitId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } }, orderBy: { startDate: "desc" }, select: { id: true, reference: true, tenant: { select: { legalName: true } } } })
      : null,
  ]);
  const fmt = { locale, currency: settings?.currency ?? "XAF" };
  const prefs = { dateFormat: settings?.dateFormat };
  const today = formatInTimeZone(new Date(), settings?.timezone ?? "Africa/Douala", "yyyy-MM-dd");
  const canManage = can(ctx, "unit.manage");
  const canBill = can(ctx, "invoice.create") && !!meter.unitId;
  // Readings are sorted newest first; the previous reading of row i is row i+1.
  const rows = meter.readings.map((r, i) => {
    const prev = meter.readings[i + 1] ?? null;
    let consumption: string;
    try {
      consumption = computeConsumption(prev?.value ?? null, r.value).toFixed(3);
    } catch {
      consumption = "—";
    }
    return { r, prev, consumption };
  });
  const latest = meter.readings[0];

  return (
    <>
      <PageHeader
        title={`${t("util.meter")} ${meter.serial}`}
        description={`${meter.property.name}${meter.unit ? ` · ${meter.unit.block ? `${meter.unit.block} · ` : ""}${meter.unit.number}` : ` · ${t("util.shared")}`}`}
        breadcrumbs={[{ label: t("util.title"), href: "/utilities" }, { label: meter.serial }]}
        actions={<Badge tone="blue">{t(`util.type.${meter.utility}`)}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("util.meter")}>
            <DescriptionList
              items={[
                { label: t("util.utility"), value: t(`util.type.${meter.utility}`) },
                { label: t("util.serial"), value: meter.serial },
                { label: t("common.building"), value: <Link className="hover:underline" href={`/properties/${meter.property.id}`}>{meter.property.name}</Link> },
                { label: t("common.unit"), value: meter.unit ? <Link className="hover:underline" href={`/units/${meter.unit.id}`}>{meter.unit.number}</Link> : t("util.shared") },
                { label: t("util.tariff"), value: money(meter.tariff).toFixed(4) },
                { label: t("util.fixedFee"), value: formatMoney(meter.fixedFee, fmt) },
                { label: t("util.lease"), value: lease ? <Link className="hover:underline" href={`/leases/${lease.id}`}>{lease.reference} · {lease.tenant.legalName}</Link> : "—" },
                { label: t("util.lastReading"), value: latest ? `${money(latest.value).toFixed(3)} · ${formatDay(latest.readingDate, prefs)}` : "—" },
              ]}
            />
          </Card>
          <Card title={t("util.readings")}>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">{t("util.noReadings")}</p>
            ) : (
              <>
                {canBill && <p className="mb-3 text-xs text-slate-500">{t("util.billHint")}</p>}
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("util.readingDate")}</Th>
                      <Th className="text-right">{t("util.previous")}</Th>
                      <Th className="text-right">{t("util.current")}</Th>
                      <Th className="text-right">{t("util.consumption")}</Th>
                      <Th className="text-right">{t("util.amount")}</Th>
                      <Th>{t("util.recordedBy")}</Th>
                      <Th>{t("util.photo")}</Th>
                      <Th>{t("util.invoice")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map(({ r, prev, consumption }) => {
                      const inv = r.charge ? invoices.find((i) => i.id === r.charge?.invoiceId) : null;
                      const est = consumption === "—" ? null : computeUtilityAmount(consumption, meter.tariff, meter.fixedFee);
                      return (
                        <Tr key={r.id}>
                          <Td className="whitespace-nowrap">{formatDay(r.readingDate, prefs)}</Td>
                          <Td className="text-right">{prev ? money(prev.value).toFixed(3) : "—"}</Td>
                          <Td className="text-right font-medium">{money(r.value).toFixed(3)}</Td>
                          <Td className="text-right">{consumption}</Td>
                          <Td className="text-right whitespace-nowrap">{r.charge ? formatMoney(r.charge.amount, fmt) : est ? <span className="text-slate-500">{formatMoney(est, fmt)}</span> : "—"}</Td>
                          <Td>{users.find((u) => u.id === r.recordedById)?.name ?? "—"}</Td>
                          <Td>{r.photoDocumentId ? <a className="text-[var(--brand)] hover:underline" href={`/api/documents/${r.photoDocumentId}`}>{t("util.viewPhoto")}</a> : "—"}</Td>
                          <Td>
                            {r.charge ? (
                              inv ? (
                                <Link className="text-[var(--brand)] hover:underline" href={`/invoices/${inv.id}`}>{inv.number}</Link>
                              ) : (
                                <Badge status="PAID">{t("util.billed")}</Badge>
                              )
                            ) : canBill ? (
                              <InlineAction action={billReadingAction} label={t("util.bill")} variant="primary" confirm={t("util.billConfirm")} hidden={{ readingId: r.id }} />
                            ) : (
                              "—"
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          {canManage && (
            <Card title={t("util.addReading")}>
              <ActionForm action={addReadingAction} resetOnSuccess>
                <input type="hidden" name="meterId" value={meter.id} />
                <Input label={t("util.readingDate")} name="readingDate" type="date" required defaultValue={today} />
                <Input label={t("util.value")} name="value" type="number" min={latest ? money(latest.value).toFixed(3) : "0"} step="0.001" inputMode="decimal" required hint={latest ? `${t("util.previous")}: ${money(latest.value).toFixed(3)}` : undefined} />
                <Field label={t("util.photo")} name="photo" hint={t("util.photoHint")}>
                  <input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="block w-full text-sm" />
                </Field>
                <SubmitButton>{t("common.save")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
