import { db } from "@/lib/db";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Card, PageHeader, Textarea } from "@/components/ui";
import { adminDict, adminMessages, resultLabels } from "../../messages";
import { bulkImportUsersAction } from "../actions";

export const metadata = { title: "Import users" };

export default async function ImportUsersPage() {
  const ctx = await requireContext("users.manage");
  const { t } = await getT(adminMessages);
  const roles = await db.role.findMany({ where: { organizationId: ctx.organizationId || "__none__", active: true, archived: false }, orderBy: { key: "asc" }, select: { key: true, name: true } });
  return (
    <>
      <PageHeader title={t("adm.users.import")} description={t("adm.import.hint")} breadcrumbs={[{ label: t("adm.users.title"), href: "/admin/users" }, { label: t("adm.users.import") }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <ResultForm action={bulkImportUsersAction} dict={adminDict(t)} labels={resultLabels(t)}>
            <Textarea label={t("adm.import.csv")} name="csv" rows={10} required className="font-mono" placeholder={"name,email,roleKey\nJane Doe,jane@example.com,cashier"} />
            <SubmitButton>{t("adm.import.run")}</SubmitButton>
          </ResultForm>
        </Card>
        <Card title={t("adm.import.roleKeys")}>
          <ul className="space-y-1 text-sm">
            {roles.map((r) => (
              <li key={r.key}><code className="font-mono text-xs">{r.key}</code> — {r.name}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{t("adm.import.scopeNote")}</p>
        </Card>
      </div>
    </>
  );
}
