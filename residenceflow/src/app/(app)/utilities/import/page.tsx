import { requireContext } from "@/lib/auth/context";
import { getT } from "@/i18n";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { utilitiesEnabled } from "../flag";
import { utilityMessages } from "../messages";
import { ImportReadingsForm } from "./import-form";

export const metadata = { title: "Import readings" };

export default async function ImportReadingsPage() {
  const ctx = await requireContext("unit.manage");
  const { t } = await getT(utilityMessages);
  if (!(await utilitiesEnabled(ctx.organizationId))) return <EmptyState title={t("util.disabled")} description={t("util.disabledHint")} />;
  return (
    <>
      <PageHeader title={t("util.importTitle")} breadcrumbs={[{ label: t("util.title"), href: "/utilities" }, { label: t("util.import") }]} />
      <Card>
        <ImportReadingsForm labels={{ csv: t("util.importCsv"), hint: t("util.importHint"), submit: t("util.import"), result: t("util.importResult"), errors: t("util.importErrors"), line: t("util.line"), error: t("util.importErrors") }} />
      </Card>
    </>
  );
}
