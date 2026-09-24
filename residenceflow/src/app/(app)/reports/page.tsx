import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { visibleReports } from "@/services/reports";
import { reportMessages } from "./i18n";

export const metadata = { title: "Reports" };

export default async function ReportsIndexPage() {
  const ctx = await requireContext();
  const { t } = await getT(reportMessages);
  const reports = visibleReports(ctx);
  if (reports.length === 0 && !ctx.permissions.has("dashboard.view")) redirect("/unauthorized");
  const groups = (["operational", "financial"] as const).map((g) => ({ g, items: reports.filter((r) => r.group === g) })).filter((x) => x.items.length > 0);
  return (
    <>
      <PageHeader title={t("rep.title")} description={t("rep.subtitle")} />
      {groups.length === 0 ? (
        <EmptyState title={t("rep.none")} />
      ) : (
        <div className="space-y-6">
          {groups.map(({ g, items }) => (
            <section key={g}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t(`rep.${g}`)}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((r) => (
                  <Link key={r.key} href={`/reports/${r.key}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                    <Card className="h-full hover:border-[var(--brand)]">
                      <div className="font-medium text-slate-900 dark:text-white">{t(`rep.r.${r.key}`)}</div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t(`rep.r.${r.key}.d`)}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
