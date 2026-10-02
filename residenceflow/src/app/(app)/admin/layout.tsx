import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { adminMessages } from "./messages";
import { visibleSections } from "./sections";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const sections = visibleSections(ctx.permissions);
  if (sections.length === 0) redirect("/unauthorized");
  const { t } = await getT(adminMessages);
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("nav.admin")}</p>
      <AdminTabs label={t("nav.admin")} tabs={sections.map((s) => ({ href: `/admin/${s.slug}`, label: t(`adm.tab.${s.slug}`) }))} />
      {children}
    </div>
  );
}
