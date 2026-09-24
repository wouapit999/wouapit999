import type { Lease } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Checkbox, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";
import { FREQUENCIES, LATE_FEE_TYPES, dayInput } from "./fields";

export interface LeaseFormDefaults {
  tenantId?: string;
  rentAmount: string;
  serviceCharge: string;
  depositAmount: string;
  frequency: string;
  graceDays: number;
  lateFeeType: string;
  lateFeeValue: string;
}

export function LeaseForm({
  action,
  lease,
  unit,
  tenants,
  defaults,
  t,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  lease?: Lease;
  unit: { id: string; label: string };
  tenants: { id: string; label: string }[];
  defaults: LeaseFormDefaults;
  t: T;
}) {
  const v = {
    tenantId: lease?.tenantId ?? defaults.tenantId ?? "",
    rentAmount: lease?.rentAmount.toString() ?? defaults.rentAmount,
    serviceCharge: lease?.serviceCharge.toString() ?? defaults.serviceCharge,
    depositAmount: lease?.depositAmount.toString() ?? defaults.depositAmount,
    frequency: lease?.frequency ?? defaults.frequency,
    graceDays: lease?.graceDays ?? defaults.graceDays,
    lateFeeType: lease?.lateFeeType ?? defaults.lateFeeType,
    lateFeeValue: lease?.lateFeeValue.toString() ?? defaults.lateFeeValue,
  };
  return (
    <ActionForm action={action} dict={{ "Please correct the highlighted fields.": t("lease.fixFields") }}>
      {lease && <input type="hidden" name="id" value={lease.id} />}
      <input type="hidden" name="unitId" value={unit.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("lease.unit")} name="unitLabel" defaultValue={unit.label} disabled />
        <Select label={t("lease.tenant")} name="tenantId" required defaultValue={v.tenantId} placeholder="—" options={tenants.map((x) => ({ value: x.id, label: x.label }))} />
        <Input label={t("lease.startDate")} name="startDate" type="date" required defaultValue={dayInput(lease?.startDate)} />
        <Input label={t("lease.endDate")} name="endDate" type="date" required defaultValue={dayInput(lease?.endDate)} />
        <Input label={t("lease.moveInDate")} name="moveInDate" type="date" defaultValue={dayInput(lease?.moveInDate)} />
        <Select label={t("lease.frequency")} name="frequency" required defaultValue={v.frequency} options={FREQUENCIES.map((f) => ({ value: f, label: t(`lease.freq.${f}`) }))} />
        <Input label={t("lease.rent")} name="rentAmount" type="number" min={0} step="0.01" required defaultValue={v.rentAmount} />
        <Input label={t("lease.serviceCharge")} name="serviceCharge" type="number" min={0} step="0.01" defaultValue={v.serviceCharge} />
        <Input label={t("lease.deposit")} name="depositAmount" type="number" min={0} step="0.01" defaultValue={v.depositAmount} />
        <Input label={t("lease.dueDay")} name="dueDay" type="number" min={1} max={31} required defaultValue={lease?.dueDay ?? 1} />
        <Input label={t("lease.graceDays")} name="graceDays" type="number" min={0} max={90} required defaultValue={v.graceDays} />
        <Input label={t("lease.noticeDays")} name="noticeDays" type="number" min={0} max={365} required defaultValue={lease?.noticeDays ?? 30} />
        <Select label={t("lease.lateFeeType")} name="lateFeeType" defaultValue={v.lateFeeType} options={LATE_FEE_TYPES.map((f) => ({ value: f, label: t(`lease.lateFee.${f}`) }))} />
        <Input label={t("lease.lateFeeValue")} name="lateFeeValue" type="number" min={0} step="0.01" defaultValue={v.lateFeeValue} />
      </div>
      <Checkbox label={t("lease.prorate")} name="prorate" defaultChecked={lease?.prorate ?? true} />
      <Textarea label={t("lease.specialTerms")} name="specialTerms" defaultValue={lease?.specialTerms} maxLength={8000} />
      <Textarea label={t("lease.renewalTerms")} name="renewalTerms" defaultValue={lease?.renewalTerms} maxLength={4000} />
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}
