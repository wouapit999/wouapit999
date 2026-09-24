import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, EmptyState, PageHeader, str } from "@/components/ui";
import { unitMessages } from "../../units/messages";
import { ApplicationForm } from "../application-form";
import { createApplicationAction } from "../actions";
import { applicationsEnabled, availableUnits } from "../data";
import { applicationMessages } from "../messages";

export const metadata = { title: "New application" };

export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("lease.create");
  const { t } = await getT(applicationMessages, unitMessages);
  const sp = await searchParams;
  const header = <PageHeader title={t("app.new")} breadcrumbs={[{ label: t("app.title"), href: "/applications" }, { label: t("app.new") }]} />;
  if (!(await applicationsEnabled(ctx.organizationId))) {
    return (
      <>
        {header}
        <EmptyState title={t("app.disabled")} description={t("app.disabledHint")} />
      </>
    );
  }
  const units = await availableUnits(ctx);
  const defaultUnitId = str(sp.unitId);
  return (
    <>
      {header}
      <Card>
        <ApplicationForm action={createApplicationAction} units={units} defaultUnitId={units.some((u) => u.id === defaultUnitId) ? defaultUnitId : undefined} t={t} />
      </Card>
    </>
  );
}
