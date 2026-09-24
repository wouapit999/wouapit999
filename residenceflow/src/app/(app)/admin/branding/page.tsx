/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { contrastWithWhite, safeBrandColor, MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES } from "@/lib/branding";
import { getT } from "@/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Checkbox, Input, PageHeader, Textarea } from "@/components/ui";
import { ColorField } from "@/components/admin/color-field";
import { adminDict, adminMessages } from "../messages";
import { saveBrandingAction } from "./actions";

export const metadata = { title: "Branding" };

const COLORS = ["primaryColor", "secondaryColor", "accentColor", "successColor", "warningColor", "errorColor"] as const;
const IMAGES = ["logoUrl", "darkLogoUrl", "iconUrl", "loginImageUrl"] as const;

export default async function BrandingPage() {
  const ctx = await requireContext("settings.branding.manage");
  const { t } = await getT(adminMessages);
  const s = await getOrgSettings(ctx.organizationId);
  if (!s) notFound();
  const ratio = contrastWithWhite(/^#[0-9a-f]{6}$/i.test(s.primaryColor) ? s.primaryColor : "#000000");
  const effective = safeBrandColor(s.primaryColor);
  const usingFallback = effective.toLowerCase() !== s.primaryColor.toLowerCase();

  return (
    <>
      <PageHeader title={t("adm.branding.title")} description={t("adm.branding.subtitle")} />
      {usingFallback && (
        <div className="mb-4">
          <Alert tone="warn">{t("adm.branding.fallback", { ratio: ratio.toFixed(2), color: effective })}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <ActionForm action={saveBrandingAction} dict={adminDict(t)} className="lg:col-span-2">
          <Card title={t("adm.branding.images")}>
            <p className="mb-3 text-xs text-slate-500">{t("adm.branding.imagesHint", { kb: Math.round(MAX_IMAGE_BYTES / 1024) })}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {IMAGES.map((f) => (
                <div key={f} className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <label htmlFor={`file_${f}`} className="block text-sm font-medium text-slate-700 dark:text-slate-200">{t(`adm.branding.${f}`)}</label>
                  <div className={`flex h-20 items-center justify-center rounded ${f === "darkLogoUrl" ? "bg-slate-900" : "bg-slate-50 dark:bg-slate-800"}`}>
                    {s[f] ? <img src={s[f]!} alt={t(`adm.branding.${f}`)} className="max-h-16 max-w-full object-contain" /> : <span className="text-xs text-slate-400">{t("adm.branding.noImage")}</span>}
                  </div>
                  <input id={`file_${f}`} name={`file_${f}`} type="file" accept={ALLOWED_IMAGE_TYPES.join(",")} className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 dark:file:bg-slate-700" />
                  {s[f] && <Checkbox name={`remove_${f}`} label={t("adm.branding.remove")} />}
                </div>
              ))}
            </div>
          </Card>
          <Card title={t("adm.branding.colors")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {COLORS.map((c) => (
                <ColorField key={c} name={c} label={t(`adm.branding.${c}`)} defaultValue={s[c]} checkContrast={c === "primaryColor"} lowContrastLabel={t("adm.branding.lowContrast")} />
              ))}
            </div>
          </Card>
          <Card title={t("adm.branding.communication")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={t("adm.branding.emailSenderName")} name="emailSenderName" defaultValue={s.emailSenderName} maxLength={100} />
              <Input label={t("adm.branding.replyTo")} name="replyToEmail" type="email" defaultValue={s.replyToEmail} maxLength={200} />
            </div>
            <div className="mt-4 space-y-4">
              <Textarea label={t("adm.branding.footerText")} name="footerText" defaultValue={s.footerText} maxLength={500} />
              <Textarea label={t("adm.branding.invoiceHeader")} name="invoiceHeader" defaultValue={s.invoiceHeader} maxLength={1000} />
              <Textarea label={t("adm.branding.invoiceFooter")} name="invoiceFooter" defaultValue={s.invoiceFooter} maxLength={1000} />
              <Textarea label={t("adm.branding.receiptFooter")} name="receiptFooter" defaultValue={s.receiptFooter} maxLength={1000} />
            </div>
          </Card>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ActionForm>
        <div>
          <Card title={t("adm.branding.preview")} className="lg:sticky lg:top-4">
            <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 px-3 py-2 text-white" style={{ backgroundColor: effective }}>
                {s.iconUrl ? <img src={s.iconUrl} alt="" className="h-6 w-6 rounded bg-white object-contain" /> : <span className="flex h-6 w-6 items-center justify-center rounded bg-white/20 text-[10px] font-bold">{s.shortName.slice(0, 3)}</span>}
                <span className="text-sm font-semibold">{s.appName}</span>
              </div>
              <div className="space-y-3 p-3">
                {s.logoUrl && <img src={s.logoUrl} alt="" className="h-10 w-auto" />}
                <p className="text-sm font-medium">{s.companyName}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded px-2 py-1 text-xs text-white" style={{ backgroundColor: effective }}>{t("adm.branding.primaryColor")}</span>
                  {(["secondaryColor", "accentColor", "successColor", "warningColor", "errorColor"] as const).map((c) => (
                    <span key={c} className="rounded px-2 py-1 text-xs text-white" style={{ backgroundColor: s[c] }}>{t(`adm.branding.${c}`)}</span>
                  ))}
                </div>
                {s.footerText && <p className="border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-700">{s.footerText}</p>}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{t("adm.branding.previewHint")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
