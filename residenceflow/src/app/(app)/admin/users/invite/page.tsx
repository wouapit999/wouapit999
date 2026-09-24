import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { SubmitButton } from "@/components/forms";
import { ResultForm } from "@/components/admin/result-form";
import { Card, Input, PageHeader, Select } from "@/components/ui";
import { adminDict, adminMessages, resultLabels } from "../../messages";
import { inviteUserAction } from "../actions";
import { AccessFields } from "../access-fields";
import { assignableRoles, orgProperties } from "../load";

export const metadata = { title: "Invite user" };

export default async function InviteUserPage() {
  const ctx = await requireContext("users.manage");
  const { t } = await getT(adminMessages);
  const [roles, properties] = await Promise.all([assignableRoles(ctx), orgProperties(ctx)]);
  return (
    <>
      <PageHeader title={t("adm.users.invite")} description={t("adm.users.inviteHint")} breadcrumbs={[{ label: t("adm.users.title"), href: "/admin/users" }, { label: t("adm.users.invite") }]} />
      <Card>
        <ResultForm action={inviteUserAction} dict={adminDict(t)} labels={resultLabels(t)} resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("common.name")} name="name" required maxLength={120} />
            <Input label={t("common.email")} name="email" type="email" required maxLength={200} />
            <Input label={t("adm.users.username")} name="username" maxLength={40} hint={t("adm.optional")} />
            <Input label={t("common.phone")} name="phone" type="tel" maxLength={40} hint={t("adm.optional")} />
            <Select label={t("common.language")} name="locale" defaultValue="" placeholder={t("adm.users.orgDefault")} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
          </div>
          <AccessFields roles={roles} properties={properties} t={t} />
          <SubmitButton>{t("adm.users.sendInvite")}</SubmitButton>
        </ResultForm>
      </Card>
    </>
  );
}
