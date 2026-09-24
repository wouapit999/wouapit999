import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Checkbox, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import type { T } from "@/i18n";
import { APPLICANT_TYPES, CHECKLIST_ITEMS } from "./messages";

export function ApplicationForm({
  action,
  units,
  defaultUnitId,
  t,
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  units: { id: string; label: string; status: string }[];
  defaultUnitId?: string;
  t: T;
}) {
  return (
    <ActionForm action={action}>
      <Alert tone="info">{t("app.fairness")}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("app.applicantName")} name="applicantName" required minLength={2} maxLength={200} />
        <Select label={t("app.applicantType")} name="applicantType" defaultValue="INDIVIDUAL" options={APPLICANT_TYPES.map((v) => ({ value: v, label: t(`app.type.${v}`) }))} />
        <Input label={t("common.email")} name="applicantEmail" type="email" maxLength={200} />
        <Input label={t("common.phone")} name="applicantPhone" type="tel" maxLength={40} />
        <Input label={t("app.employer")} name="employer" maxLength={200} />
        <Input label={t("app.monthlyIncome")} name="monthlyIncome" type="number" min="0" step="0.01" inputMode="decimal" />
        <Input label={t("app.householdSize")} name="householdSize" type="number" min={1} max={50} defaultValue={1} />
        <Input label={t("app.desiredMoveIn")} name="desiredMoveIn" type="date" />
        <Select
          label={t("app.desiredUnit")}
          name="unitId"
          defaultValue={defaultUnitId ?? ""}
          placeholder={t("common.none")}
          hint={t("app.desiredUnitHint")}
          options={units.map((u) => ({ value: u.id, label: `${u.label} — ${t(`unit.status.${u.status}`)}` }))}
        />
        <Input label={t("app.reservationFee")} name="reservationFee" type="number" min="0" step="0.01" inputMode="decimal" hint={t("app.reservationHint")} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("app.checklist")}</legend>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("app.checklistHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHECKLIST_ITEMS.map((item) => (
            <Checkbox key={item} name="checklist" value={item} label={t(`app.check.${item}`)} />
          ))}
        </div>
      </fieldset>
      <Textarea label={t("common.notes")} name="notes" maxLength={8000} />
      <SubmitButton>{t("common.create")}</SubmitButton>
    </ActionForm>
  );
}
