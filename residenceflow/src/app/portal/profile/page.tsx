import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Checkbox, DescriptionList, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { COMM_CHANNELS } from "@/services/portal";
import { profileChangeRequestAction, updatePortalProfileAction } from "../actions";
import { PORTAL_ERROR_KEYS, dictFor, portalPage } from "../kit";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function PortalProfilePage() {
  const { ctx, tenantId, t, occupant } = await portalPage();
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, organizationId: ctx.organizationId },
    select: { reference: true, legalName: true, preferredName: true, email: true, phone: true, altPhone: true, language: true, commPreferences: true, postalAddress: true, type: true },
  });
  if (!tenant) notFound();
  const dict = dictFor(t, PORTAL_ERROR_KEYS);
  return (
    <>
      <PageHeader title={t("nav.portal.profile")} actions={<LinkButton variant="secondary" href="/change-password">{t("portal.profile.security")}</LinkButton>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("portal.profile.account")}>
          <DescriptionList
            items={[
              { label: t("portal.profile.signedInAs"), value: `${ctx.user.name} (${ctx.user.email})` },
              { label: t("portal.profile.reference"), value: tenant.reference },
              { label: t("portal.profile.legalName"), value: tenant.legalName },
              { label: t("common.email"), value: tenant.email },
              { label: t("common.phone"), value: tenant.phone },
              { label: t("portal.profile.altPhone"), value: tenant.altPhone },
              { label: t("portal.profile.address"), value: tenant.postalAddress },
              { label: t("common.language"), value: tenant.language === "en" ? "English" : "Français" },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">{t("portal.profile.securityHint")}</p>
        </Card>

        {!occupant && (
          <Card title={t("portal.profile.contact")}>
            <ActionForm action={updatePortalProfileAction} dict={dict}>
              <Input label={t("common.phone")} name="phone" type="tel" defaultValue={tenant.phone} maxLength={40} autoComplete="tel" />
              <Input label={t("portal.profile.altPhone")} name="altPhone" type="tel" defaultValue={tenant.altPhone} maxLength={40} />
              <Select label={t("common.language")} name="language" defaultValue={tenant.language === "en" ? "en" : "fr"} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("portal.profile.channels")}</legend>
                {COMM_CHANNELS.map((c) => (
                  <Checkbox key={c} name="commPreferences" value={c} label={t(`portal.channel.${c}`)} defaultChecked={tenant.commPreferences.includes(c)} />
                ))}
              </fieldset>
              <SubmitButton>{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
        )}

        <Card title={t("portal.profile.changeRequest")} className="lg:col-span-2">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t("portal.profile.changeHint")}</p>
          <ActionForm action={profileChangeRequestAction} resetOnSuccess dict={dict} className="max-w-lg">
            <Input label={t("portal.profile.newLegalName")} name="legalName" maxLength={200} />
            <Input label={t("portal.profile.newEmail")} name="email" type="email" maxLength={200} />
            <Textarea label={t("portal.profile.details")} name="details" maxLength={2000} />
            <SubmitButton variant="secondary">{t("portal.profile.sendRequest")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
