import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { adminDict, adminMessages } from "../messages";
import { updateSequenceAction } from "./actions";

export const metadata = { title: "Numbering" };

export default async function NumberingPage() {
  const ctx = await requireContext("settings.general.manage");
  const { t } = await getT(adminMessages);
  const seqs = await db.numberSequence.findMany({ where: { organizationId: ctx.organizationId || "__none__" }, orderBy: { key: "asc" } });
  const dict = adminDict(t);
  return (
    <>
      <PageHeader title={t("adm.numbering.title")} description={t("adm.numbering.subtitle")} />
      {seqs.length === 0 ? (
        <EmptyState title={t("common.empty")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {seqs.map((s) => (
            <Card key={s.id} title={t(`adm.seq.${s.key}`) === `adm.seq.${s.key}` ? s.key : t(`adm.seq.${s.key}`)}>
              <p className="mb-3 text-sm">
                {t("adm.numbering.next")}: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono dark:bg-slate-800">{`${s.prefix}${String(s.nextValue).padStart(s.padding, "0")}`}</code>
              </p>
              <ActionForm action={updateSequenceAction} dict={dict}>
                <input type="hidden" name="id" value={s.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input label={t("adm.numbering.prefix")} name="prefix" defaultValue={s.prefix} maxLength={12} />
                  <Input label={t("adm.numbering.padding")} name="padding" type="number" min={1} max={10} defaultValue={s.padding} />
                  <Input label={t("adm.numbering.nextValue")} name="nextValue" type="number" min={s.nextValue} defaultValue={s.nextValue} />
                </div>
                <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">{t("adm.numbering.hint")}</p>
    </>
  );
}
