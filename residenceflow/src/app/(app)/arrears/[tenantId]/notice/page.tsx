/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { invoiceWhere, requireContext, tenantWhere } from "@/lib/auth/context";
import { getT, type Locale } from "@/i18n";
import { getOrgSettings } from "@/lib/settings";
import { formatDate, formatDay, formatMoney } from "@/lib/format";
import { money } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, PageHeader, Select, buttonClass, str } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { NOTICE_LEVELS, isNoticeLevel, renderNotice, type NoticeLanguage } from "@/domain/notice-templates";
import { daysOverdue } from "@/domain/aging";
import { invoiceBalance, todayUtc } from "@/services/billing";
import { OPEN_INVOICE_STATUSES } from "@/services/finance-extra";
import { financeMessages } from "../../../invoices/messages";
import { arrearsMessages } from "../../messages";
import { recordNoticeAction } from "./actions";

export const metadata = { title: "Arrears notice" };

export default async function ArrearsNoticePage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await params;
  const ctx = await requireContext("arrears.manage");
  const { t, locale } = await getT(financeMessages, arrearsMessages);
  const sp = await searchParams;
  const levelParam = str(sp.level);
  const level = isNoticeLevel(levelParam) ? levelParam : "REMINDER";
  const settings = await getOrgSettings(ctx.organizationId);
  const langParam = str(sp.language);
  const language: NoticeLanguage = langParam === "en" || langParam === "fr" ? langParam : ((settings?.defaultLanguage as Locale | undefined) ?? locale);

  const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: tenantId }] }, select: { id: true, legalName: true, reference: true, postalAddress: true } });
  if (!tenant) notFound();
  const invoices = await db.invoice.findMany({
    where: { AND: [invoiceWhere(ctx), { tenantId: tenant.id, status: { in: [...OPEN_INVOICE_STATUSES] } }] },
    orderBy: { dueDate: "asc" },
    include: { lease: { select: { unit: { select: { number: true, property: { select: { name: true } } } } } } },
  });
  const today = todayUtc();
  const fmt = { locale: language, currency: settings?.currency ?? "XAF" };
  const df = { dateFormat: settings?.dateFormat, timezone: settings?.timezone ?? "Africa/Douala" };
  const open = invoices.map((i) => ({ ...i, balance: invoiceBalance(i) })).filter((i) => i.balance.gt(0));
  const outstanding = open.reduce((s, i) => s.plus(i.balance), money(0));
  const oldest = open[0] ?? null;
  const unitInv = open.find((i) => i.lease) ?? invoices.find((i) => i.lease) ?? null;

  const notice = renderNotice(level, language, {
    tenantName: tenant.legalName,
    unit: unitInv?.lease?.unit.number ?? "—",
    building: unitInv?.lease?.unit.property.name ?? "—",
    outstanding: formatMoney(outstanding, fmt),
    oldestDueDate: oldest ? formatDay(oldest.dueDate, df) : "—",
    daysOverdue: oldest ? Math.max(0, daysOverdue(oldest.dueDate, today)) : 0,
    date: formatDate(new Date(), df),
    companyName: settings?.companyName || settings?.appName || "",
    phone: settings?.phone || "—",
  });
  const fullText = `${notice.title}\n\n${notice.body}`;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t("arr.notice")}
          description={`${tenant.legalName} · ${tenant.reference}`}
          breadcrumbs={[{ label: t("arr.title"), href: "/arrears" }, { label: tenant.legalName, href: `/arrears/${tenant.id}` }, { label: t("arr.notice") }]}
          actions={<PrintButton label={t("fin.print")} />}
        />
        <div className="mb-4"><Alert tone="warn">{t("arr.noticeDisclaimer")}</Alert></div>
        {open.length === 0 && <div className="mb-4"><Alert tone="info">{t("arr.empty")}</Alert></div>}
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Select label={t("arr.noticeLevel")} name="level" defaultValue={level} options={NOTICE_LEVELS.map((l) => ({ value: l, label: t(`arr.noticeLevel.${l}`) }))} wrapperClassName="w-full sm:w-56" />
          <Select label={t("common.language")} name="language" defaultValue={language} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} wrapperClassName="w-full sm:w-44" />
          <button type="submit" className={buttonClass("secondary")}>{t("arr.noticePreview")}</button>
        </form>
      </div>

      <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8 print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {settings?.logoUrl ? <img src={settings.logoUrl} alt="" className="mb-2 h-10 w-auto" /> : null}
            <div className="font-semibold">{settings?.companyName || settings?.appName}</div>
            <div className="text-xs text-slate-600">{settings?.address}</div>
            <div className="text-xs text-slate-600">{[settings?.phone, settings?.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="text-sm sm:text-right">
            <div className="font-medium">{tenant.legalName}</div>
            <div className="text-xs text-slate-600">{tenant.reference}</div>
            {tenant.postalAddress && <div className="text-xs text-slate-600">{tenant.postalAddress}</div>}
          </div>
        </header>
        <h1 className="mt-6 text-lg font-semibold uppercase">{notice.title}</h1>
        <div className="mt-4 whitespace-pre-line text-sm leading-relaxed">{notice.body}</div>
        {settings?.invoiceFooter && <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-600">{settings.invoiceFooter}</footer>}
      </article>

      <div className="no-print mx-auto mt-6 max-w-3xl">
        <ActionForm action={recordNoticeAction} confirm={t("arr.noticeRecordConfirm")}>
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="level" value={level} />
          <input type="hidden" name="language" value={language} />
          <input type="hidden" name="body" value={fullText} />
          <p className="text-xs text-slate-500">{t("arr.noticeRecordHint")}</p>
          <SubmitButton>{t("arr.noticeRecord")}</SubmitButton>
        </ActionForm>
      </div>
    </>
  );
}
