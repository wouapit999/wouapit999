import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can, requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/format";
import { ActionForm, InlineAction } from "@/components/forms";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, Checkbox, DescriptionList, Input, LinkButton, PageHeader, Table, Td, Textarea, Th, Tr, buttonClass, inputClass, str } from "@/components/ui";
import { cancelInspectionAction, saveInspectionAction } from "../actions";
import { CONDITIONS, parseChecklist, rowKey, type ChecklistRow } from "../checklist";
import { CONDITION_TONE, itemLabel, roomLabel } from "../labels";
import { inspectionMessages } from "../messages";
import { inspectionScope } from "../scope";

export const metadata = { title: "Inspection" };

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireContext("inspection.view");
  const { t } = await getT(inspectionMessages);
  const insp = await db.inspection.findFirst({
    where: { ...inspectionScope(ctx), id },
    include: {
      unit: { select: { id: true, number: true, block: true, floor: true, property: { select: { name: true, address: true, city: true } } } },
      lease: { select: { id: true, reference: true, tenant: { select: { legalName: true } } } },
    },
  });
  if (!insp) notFound();
  const settings = await getOrgSettings(ctx.organizationId);
  const prefs = { timezone: settings?.timezone ?? "Africa/Douala", dateFormat: settings?.dateFormat };
  const rows = parseChecklist(insp.items);
  const printMode = str(sp.print) === "1";
  const editable = insp.status === "SCHEDULED" && can(ctx, "inspection.manage") && !printMode;

  // Move-out: compare with the latest completed move-in of the same lease, else of the same unit.
  let moveIn: { rows: ChecklistRow[]; completedAt: Date | null } | null = null;
  if (insp.type === "MOVE_OUT") {
    const base = { ...inspectionScope(ctx), type: "MOVE_IN", status: "COMPLETED", id: { not: insp.id } };
    const found =
      (insp.leaseId ? await db.inspection.findFirst({ where: { ...base, leaseId: insp.leaseId }, orderBy: { completedAt: "desc" } }) : null) ??
      (await db.inspection.findFirst({ where: { ...base, unitId: insp.unitId }, orderBy: { completedAt: "desc" } }));
    if (found) moveIn = { rows: parseChecklist(found.items), completedAt: found.completedAt };
  }
  const unitLabel = `${insp.unit.block ? `${insp.unit.block} · ` : ""}${insp.unit.number}`;
  const title = `${t(`insp.type.${insp.type}`)} — ${insp.unit.property.name} · ${unitLabel}`;

  // Group rows by room while keeping the original index (form field names use it).
  const groups: { label: string; items: { row: ChecklistRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const label = roomLabel(t, row);
    const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]);
    g.items.push({ row, index });
  });
  const condBadge = (c: string) => (c ? <Badge tone={CONDITION_TONE[c]}>{t(`insp.cond.${c}`)}</Badge> : <span className="text-slate-400">{t("insp.cond.none")}</span>);

  return (
    <>
      <PageHeader
        title={title}
        description={`${t("insp.scheduledFor")}: ${formatDateTime(insp.scheduledFor, prefs)}`}
        breadcrumbs={[{ label: t("insp.title"), href: "/inspections" }, { label: title }]}
        actions={
          <>
            {printMode ? <PrintButton label={t("insp.print")} /> : <LinkButton variant="secondary" href={`/inspections/${insp.id}?print=1`} className="no-print">{t("insp.print")}</LinkButton>}
            {editable && <InlineAction action={cancelInspectionAction} label={t("insp.cancel")} variant="danger" confirm={t("insp.cancelConfirm")} hidden={{ id: insp.id }} />}
          </>
        }
      />
      <div className="space-y-6">
        <Card>
          <DescriptionList
            items={[
              { label: t("common.status"), value: <Badge status={insp.status}>{t(`insp.status.${insp.status}`)}</Badge> },
              { label: t("common.building"), value: [insp.unit.property.name, insp.unit.property.address, insp.unit.property.city].filter(Boolean).join(", ") },
              { label: t("common.unit"), value: unitLabel },
              { label: t("common.tenant"), value: insp.lease ? `${insp.lease.tenant.legalName} (${insp.lease.reference})` : null },
              { label: t("insp.inspector"), value: insp.inspectorName },
              { label: t("insp.completedAt"), value: insp.completedAt ? formatDateTime(insp.completedAt, prefs) : null },
            ]}
          />
        </Card>

        {editable ? (
          <ActionForm action={saveInspectionAction}>
            <input type="hidden" name="id" value={insp.id} />
            <Card title={t("insp.checklist")}>
              <div className="space-y-5">
                {groups.map((g) => (
                  <fieldset key={g.label} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <legend className="px-1 text-sm font-semibold">{g.label}</legend>
                    <div className="space-y-3">
                      {g.items.map(({ row, index }) => (
                        <div key={index} className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr] sm:items-center">
                          <label htmlFor={`cond_${index}`} className="text-sm font-medium">{itemLabel(t, row.item)}</label>
                          <select id={`cond_${index}`} name={`cond_${index}`} defaultValue={row.condition} className={inputClass}>
                            <option value="">{t("insp.cond.none")}</option>
                            {CONDITIONS.map((c) => (
                              <option key={c} value={c}>{t(`insp.cond.${c}`)}</option>
                            ))}
                          </select>
                          <input name={`notes_${index}`} defaultValue={row.notes} maxLength={500} placeholder={t("insp.notes")} aria-label={`${g.label} · ${itemLabel(t, row.item)} · ${t("insp.notes")}`} className={inputClass} />
                        </div>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <fieldset className="rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-600">
                  <legend className="px-1 text-sm">{t("insp.addRow")}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label={t("insp.customRoom")} name="customRoom" maxLength={80} />
                    <Input label={t("insp.customItem")} name="customItem" maxLength={80} />
                  </div>
                </fieldset>
              </div>
            </Card>
            <Card>
              <div className="space-y-4">
                <Input label={t("insp.inspector")} name="inspectorName" defaultValue={insp.inspectorName} maxLength={120} />
                <Textarea label={t("insp.meterReadings")} name="meterReadings" defaultValue={insp.meterReadings} maxLength={2000} />
                <Textarea label={t("insp.keys")} name="keysHandedOver" defaultValue={insp.keysHandedOver} maxLength={1000} />
                <Textarea label={t("insp.generalNotes")} name="notes" defaultValue={insp.notes} maxLength={4000} />
                <Checkbox label={t("insp.acknowledged")} name="tenantAcknowledged" defaultChecked={insp.tenantAcknowledged} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="intent" value="save" className={buttonClass("secondary")}>{t("insp.save")}</button>
                  <button type="submit" name="intent" value="complete" className={buttonClass("primary")}>{t("insp.complete")}</button>
                </div>
              </div>
            </Card>
          </ActionForm>
        ) : (
          <>
            <Card title={t("insp.checklist")}>
              <Table>
                <thead>
                  <tr>
                    <Th>{t("insp.room")}</Th>
                    <Th>{t("insp.item")}</Th>
                    <Th>{t("insp.condition")}</Th>
                    <Th>{t("insp.notes")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r, i) => (
                    <Tr key={i}>
                      <Td>{roomLabel(t, r)}</Td>
                      <Td>{itemLabel(t, r.item)}</Td>
                      <Td>{condBadge(r.condition)}</Td>
                      <Td>{r.notes}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <DescriptionList
                items={[
                  { label: t("insp.meterReadings"), value: <span className="whitespace-pre-line">{insp.meterReadings}</span> },
                  { label: t("insp.keys"), value: <span className="whitespace-pre-line">{insp.keysHandedOver}</span> },
                  { label: t("insp.generalNotes"), value: <span className="whitespace-pre-line">{insp.notes}</span> },
                  { label: t("insp.acknowledged"), value: insp.tenantAcknowledged ? "✓" : "✗" },
                ]}
              />
              {printMode && (
                <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
                  <div className="border-t border-slate-400 pt-2">{t("insp.signInspector")}</div>
                  <div className="border-t border-slate-400 pt-2">{t("insp.signTenant")}</div>
                </div>
              )}
            </Card>
          </>
        )}

        {insp.type === "MOVE_OUT" && (
          <Card title={t("insp.comparison")}>
            {!moveIn ? (
              <p className="text-sm text-slate-500">{t("insp.noMoveIn")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("insp.room")}</Th>
                    <Th>{t("insp.item")}</Th>
                    <Th>{t("insp.moveIn")}{moveIn.completedAt ? ` (${formatDateTime(moveIn.completedAt, prefs)})` : ""}</Th>
                    <Th>{t("insp.moveOut")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r, i) => {
                    const before = moveIn!.rows.find((m) => rowKey(m) === rowKey(r));
                    const changed = !!before && !!r.condition && !!before.condition && before.condition !== r.condition;
                    return (
                      <Tr key={i}>
                        <Td>{roomLabel(t, r)}</Td>
                        <Td>
                          {itemLabel(t, r.item)}
                          {changed && <span className="ml-2"><Badge tone="amber">{t("insp.changed")}</Badge></span>}
                        </Td>
                        <Td>
                          {before ? condBadge(before.condition) : "—"}
                          {before?.notes && <div className="text-xs text-slate-500">{before.notes}</div>}
                        </Td>
                        <Td>
                          {condBadge(r.condition)}
                          {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
